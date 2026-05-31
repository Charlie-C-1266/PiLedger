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

from db import db, from_cents, to_cents
from auth import require_auth
from schemas import (
    BudgetEnvelopeOut,
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
    return BudgetIncomeOut(
        id=row["id"],
        label=row["label"],
        amount=from_cents(row["amount_cents"]) or 0.0,
        sort_order=row["sort_order"],
    )


def _group_to_out(row: sqlite3.Row) -> BudgetGroupOut:
    return BudgetGroupOut(
        id=row["id"],
        name=row["name"],
        color=row["color"],
        flexible=bool(row["flexible"]),
        sort_order=row["sort_order"],
    )


def _next_sort_order(conn: sqlite3.Connection, table: str, uid: int) -> int:
    """Append position: one past the user's current max in `table`."""
    return conn.execute(
        f"SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {table} WHERE user_id=?",
        (uid,),
    ).fetchone()[0]


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

    envelopes_by_group: dict[int, list[BudgetEnvelopeOut]] = {}
    for e in envelope_rows:
        envelopes_by_group.setdefault(e["group_id"], []).append(
            BudgetEnvelopeOut(
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
