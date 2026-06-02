"""Zero-based envelope budget — read API.

`GET /api/budget` returns the user's manual income lines, their envelope groups
(each with its envelopes), and a 6-month budget-vs-actual history. Budgeted and
income figures are user-entered and stored monthly; each envelope's `spent` is
computed live from the current month's negative transactions in that envelope's
category, converted into the user's base currency via ``services/currency``.

The trend `history` compares each of the last six months' actual spend (across
enveloped categories) against the *current* total allocation — we don't snapshot
historical plans, so the budgeted line is a flat present-day reference.
"""

from datetime import datetime, timezone
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from constants import DEFAULT_CATEGORIES
from db import db, from_cents, to_cents
from auth import require_auth
from schemas import (
    BudgetEnvelopeDetailOut,
    BudgetEnvelopeIn,
    BudgetEnvelopeOut,
    BudgetEnvelopePatch,
    BudgetGroupDetailOut,
    BudgetGroupIn,
    BudgetGroupOut,
    BudgetGroupPatch,
    BudgetHistoryPoint,
    BudgetIncomeIn,
    BudgetIncomeOut,
    BudgetIncomePatch,
    BudgetOut,
    OkOut,
)
from services.currency import _convert_to_base, _load_rates

router = APIRouter(tags=["budget"])

_HISTORY_MONTHS = 6


def _income_to_out(row: sqlite3.Row) -> BudgetIncomeOut:
    """Map a ``budget_income`` row to ``BudgetIncomeOut`` (cents → dollars)."""
    return BudgetIncomeOut(
        id=row["id"],
        label=row["label"],
        amount=from_cents(row["amount_cents"]) or 0.0,
        sort_order=row["sort_order"],
    )


def _group_to_out(row: sqlite3.Row) -> BudgetGroupOut:
    """Map a ``budget_group`` row to ``BudgetGroupOut`` (0/1 ``flexible`` → bool)."""
    return BudgetGroupOut(
        id=row["id"],
        name=row["name"],
        color=row["color"],
        flexible=bool(row["flexible"]),
        sort_order=row["sort_order"],
    )


def _envelope_to_out(row: sqlite3.Row) -> BudgetEnvelopeOut:
    """Map a ``budget_envelope`` row to the bare ``BudgetEnvelopeOut`` (CRUD
    shape, without the live ``spent`` that the ``GET /api/budget`` aggregate adds)."""
    return BudgetEnvelopeOut(
        id=row["id"],
        group_id=row["group_id"],
        label=row["label"],
        category=row["category"],
        budgeted=from_cents(row["budgeted_cents"]) or 0.0,
        sort_order=row["sort_order"],
    )


def _next_sort_order(conn: sqlite3.Connection, table: str, uid: int) -> int:
    """Append position: one past the user's current max in `table`."""
    return conn.execute(
        f"SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {table} WHERE user_id=?",
        (uid,),
    ).fetchone()[0]


def _require_owned_group(conn: sqlite3.Connection, gid: int, uid: int) -> None:
    """404 unless the group exists and belongs to the user."""
    if not conn.execute(
        "SELECT 1 FROM budget_group WHERE id=? AND user_id=?", (gid, uid)
    ).fetchone():
        raise HTTPException(404, "Group not found")


def _require_category(conn: sqlite3.Connection, uid: int, category: str) -> None:
    """422 unless `category` is one the user actually has — a built-in default
    or one of their custom categories. Keeps envelopes pinned to real spend
    buckets so `spent` can be computed."""
    if category in DEFAULT_CATEGORIES:
        return
    if conn.execute(
        "SELECT 1 FROM user_categories WHERE user_id=? AND name=?", (uid, category)
    ).fetchone():
        return
    raise HTTPException(422, "Category does not exist")


def _month_keys(now: datetime, count: int) -> list[str]:
    """The last ``count`` month keys ("YYYY-MM"), oldest first, ending on the
    month containing ``now`` (which is therefore the last element)."""
    keys: list[str] = []
    for i in range(count - 1, -1, -1):
        year, month = now.year, now.month - i
        while month <= 0:
            month += 12
            year -= 1
        keys.append(f"{year:04d}-{month:02d}")
    return keys


@router.get("/api/budget", response_model=BudgetOut)
def get_budget(uid: int = Depends(require_auth)) -> BudgetOut:
    """Return the whole budget the screen renders: income lines, groups nesting
    their envelopes, and a 6-month budgeted-vs-spent trend.

    Each envelope's ``spent`` is the current month's negative transactions in its
    category, converted to base currency (missing rates fall back to 1:1 and are
    reported in ``missing_rates``). The trend compares each month's actual spend
    against the *current* total allocation as a flat line, and is empty until the
    user has at least one envelope.
    """
    now = datetime.now(timezone.utc)
    months = _month_keys(now, _HISTORY_MONTHS)
    current_key = months[-1]
    # Start of the oldest month in the window — occurred_at is a normalised,
    # lexically-sortable ISO string, so a string comparison is a date comparison.
    window_start = f"{months[0]}-01T00:00:00Z"

    with db() as conn:
        user = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        base = (user["base_currency"] if user else None) or "GBP"
        rates = _load_rates(conn, uid)

        income_rows = conn.execute(
            "SELECT id, label, amount_cents, sort_order FROM budget_income"
            " WHERE user_id=? ORDER BY sort_order, id",
            (uid,),
        ).fetchall()
        group_rows = conn.execute(
            "SELECT id, name, color, flexible, sort_order FROM budget_group"
            " WHERE user_id=? ORDER BY sort_order, id",
            (uid,),
        ).fetchall()
        envelope_rows = conn.execute(
            "SELECT id, group_id, label, category, budgeted_cents, sort_order"
            " FROM budget_envelope WHERE user_id=? ORDER BY sort_order, id",
            (uid,),
        ).fetchall()

        # Negative transactions since the window start, with each account's
        # currency so amounts can be converted to base before summing.
        txn_rows = conn.execute(
            "SELECT t.occurred_at, t.category, t.amount_cents, a.currency"
            " FROM transactions t JOIN accounts a ON a.id = t.account_id"
            " WHERE t.user_id=? AND t.amount_cents < 0 AND t.occurred_at >= ?",
            (uid, window_start),
        ).fetchall()

    enveloped = {e["category"] for e in envelope_rows}

    # Bucket spend (in base currency) by category for the current month, and by
    # month across all enveloped categories for the trend.
    missing: set[str] = set()
    spent_by_category: dict[str, float] = {}
    spent_by_month: dict[str, float] = {}
    for t in txn_rows:
        cur = t["currency"] or "GBP"
        if cur != base and cur not in rates:
            missing.add(cur)
        amount = _convert_to_base(abs(t["amount_cents"]) / 100, cur, base, rates)
        month_key = t["occurred_at"][:7]
        if month_key == current_key:
            spent_by_category[t["category"]] = (
                spent_by_category.get(t["category"], 0.0) + amount
            )
        if t["category"] in enveloped:
            spent_by_month[month_key] = spent_by_month.get(month_key, 0.0) + amount

    envelopes_by_group: dict[int, list[BudgetEnvelopeDetailOut]] = {}
    for e in envelope_rows:
        envelopes_by_group.setdefault(e["group_id"], []).append(
            BudgetEnvelopeDetailOut(
                id=e["id"],
                group_id=e["group_id"],
                label=e["label"],
                category=e["category"],
                budgeted=from_cents(e["budgeted_cents"]) or 0.0,
                spent=round(spent_by_category.get(e["category"], 0.0), 2),
                sort_order=e["sort_order"],
            )
        )

    groups = [
        BudgetGroupDetailOut(
            id=g["id"],
            name=g["name"],
            color=g["color"],
            flexible=bool(g["flexible"]),
            sort_order=g["sort_order"],
            envelopes=envelopes_by_group.get(g["id"], []),
        )
        for g in group_rows
    ]
    incomes = [
        BudgetIncomeOut(
            id=i["id"],
            label=i["label"],
            amount=from_cents(i["amount_cents"]) or 0.0,
            sort_order=i["sort_order"],
        )
        for i in income_rows
    ]

    # Trend only makes sense once something is budgeted; an empty budget has no
    # allocation line to compare against, so it returns no history points.
    if envelope_rows:
        allocation = round(
            sum(from_cents(e["budgeted_cents"]) or 0.0 for e in envelope_rows), 2
        )
        history = [
            BudgetHistoryPoint(
                month=key,
                budgeted=allocation,
                spent=round(spent_by_month.get(key, 0.0), 2),
            )
            for key in months
        ]
    else:
        history = []

    return BudgetOut(
        incomes=incomes,
        groups=groups,
        history=history,
        base_currency=base,
        missing_rates=sorted(missing),
    )


# ── Income CRUD ───────────────────────────────────────────────────────────────


@router.post("/api/budget/income", status_code=201, response_model=BudgetIncomeOut)
def create_income(
    data: BudgetIncomeIn, uid: int = Depends(require_auth)
) -> BudgetIncomeOut:
    """Create an income line for the user, appended to the end of their list."""
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO budget_income(user_id, label, amount_cents, sort_order)"
            " VALUES(?, ?, ?, ?)",
            (
                uid,
                data.label,
                to_cents(data.amount),
                _next_sort_order(conn, "budget_income", uid),
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM budget_income WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _income_to_out(row)


@router.put("/api/budget/income/{iid}", response_model=BudgetIncomeOut)
def update_income(
    iid: int, data: BudgetIncomePatch, uid: int = Depends(require_auth)
) -> BudgetIncomeOut:
    """Patch the supplied fields of one of the user's income lines (404 if not
    theirs). Used for renames, amount edits, and reordering via ``sort_order``."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_income WHERE id=? AND user_id=?", (iid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        # exclude_none: budget income has no nullable columns, so an omitted
        # field is left unchanged and `null` is never written.
        patch = data.model_dump(exclude_none=True)
        if "amount" in patch:
            patch["amount_cents"] = to_cents(patch.pop("amount"))
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(
                f"UPDATE budget_income SET {sets} WHERE id=?", [*patch.values(), iid]
            )
            conn.commit()
        row = conn.execute("SELECT * FROM budget_income WHERE id=?", (iid,)).fetchone()
    return _income_to_out(row)


@router.delete("/api/budget/income/{iid}", response_model=OkOut)
def delete_income(iid: int, uid: int = Depends(require_auth)) -> OkOut:
    """Delete one of the user's income lines (404 if not theirs)."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_income WHERE id=? AND user_id=?", (iid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM budget_income WHERE id=?", (iid,))
        conn.commit()
    return OkOut(ok=True)


# ── Group CRUD ────────────────────────────────────────────────────────────────


@router.post("/api/budget/groups", status_code=201, response_model=BudgetGroupOut)
def create_group(
    data: BudgetGroupIn, uid: int = Depends(require_auth)
) -> BudgetGroupOut:
    """Create an envelope group for the user, appended to the end of their list.
    The ``flexible`` flag marks a group whose remaining budget counts as
    safe-to-spend."""
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO budget_group(user_id, name, color, flexible, sort_order)"
            " VALUES(?, ?, ?, ?, ?)",
            (
                uid,
                data.name,
                data.color,
                int(data.flexible),
                _next_sort_order(conn, "budget_group", uid),
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM budget_group WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _group_to_out(row)


@router.put("/api/budget/groups/{gid}", response_model=BudgetGroupOut)
def update_group(
    gid: int, data: BudgetGroupPatch, uid: int = Depends(require_auth)
) -> BudgetGroupOut:
    """Patch the supplied fields of one of the user's groups (404 if not theirs)
    — name, colour, flexible flag, or ``sort_order``."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_group WHERE id=? AND user_id=?", (gid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        patch = data.model_dump(exclude_none=True)
        if "flexible" in patch:
            patch["flexible"] = int(patch["flexible"])
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(
                f"UPDATE budget_group SET {sets} WHERE id=?", [*patch.values(), gid]
            )
            conn.commit()
        row = conn.execute("SELECT * FROM budget_group WHERE id=?", (gid,)).fetchone()
    return _group_to_out(row)


@router.delete("/api/budget/groups/{gid}", response_model=OkOut)
def delete_group(gid: int, uid: int = Depends(require_auth)) -> OkOut:
    """Delete a group; its envelopes cascade via the FK (db() runs with
    foreign_keys ON)."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_group WHERE id=? AND user_id=?", (gid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM budget_group WHERE id=?", (gid,))
        conn.commit()
    return OkOut(ok=True)


# ── Envelope CRUD ─────────────────────────────────────────────────────────────


@router.post("/api/budget/envelopes", status_code=201, response_model=BudgetEnvelopeOut)
def create_envelope(
    data: BudgetEnvelopeIn, uid: int = Depends(require_auth)
) -> BudgetEnvelopeOut:
    """Create an envelope in one of the user's groups.

    Validates that the group is owned (404) and the category is real (422), and
    surfaces the ``UNIQUE(user_id, category)`` clash as 409 so a category can't
    be enveloped twice (which would double-count its spend).
    """
    with db() as conn:
        _require_owned_group(conn, data.group_id, uid)
        _require_category(conn, uid, data.category)
        try:
            cur = conn.execute(
                "INSERT INTO budget_envelope(user_id, group_id, label, category,"
                " budgeted_cents, sort_order) VALUES(?, ?, ?, ?, ?, ?)",
                (
                    uid,
                    data.group_id,
                    data.label,
                    data.category,
                    to_cents(data.budgeted),
                    _next_sort_order(conn, "budget_envelope", uid),
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # UNIQUE(user_id, category): the category is already enveloped.
            raise HTTPException(409, "Category is already in an envelope")
        row = conn.execute(
            "SELECT * FROM budget_envelope WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _envelope_to_out(row)


@router.put("/api/budget/envelopes/{eid}", response_model=BudgetEnvelopeOut)
def update_envelope(
    eid: int, data: BudgetEnvelopePatch, uid: int = Depends(require_auth)
) -> BudgetEnvelopeOut:
    """Patch the supplied fields of one of the user's envelopes (404 if not
    theirs).

    Can move it to another owned group (404 otherwise) or change its category
    (re-validated, 422 otherwise); a category clash surfaces as 409.
    """
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_envelope WHERE id=? AND user_id=?", (eid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        patch = data.model_dump(exclude_none=True)
        if "group_id" in patch:
            _require_owned_group(conn, patch["group_id"], uid)
        if "category" in patch:
            _require_category(conn, uid, patch["category"])
        if "budgeted" in patch:
            patch["budgeted_cents"] = to_cents(patch.pop("budgeted"))
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            try:
                conn.execute(
                    f"UPDATE budget_envelope SET {sets} WHERE id=?",
                    [*patch.values(), eid],
                )
                conn.commit()
            except sqlite3.IntegrityError:
                raise HTTPException(409, "Category is already in an envelope")
        row = conn.execute(
            "SELECT * FROM budget_envelope WHERE id=?", (eid,)
        ).fetchone()
    return _envelope_to_out(row)


@router.delete("/api/budget/envelopes/{eid}", response_model=OkOut)
def delete_envelope(eid: int, uid: int = Depends(require_auth)) -> OkOut:
    """Delete one of the user's envelopes (404 if not theirs)."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_envelope WHERE id=? AND user_id=?", (eid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM budget_envelope WHERE id=?", (eid,))
        conn.commit()
    return OkOut(ok=True)
