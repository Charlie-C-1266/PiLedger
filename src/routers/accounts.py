"""Accounts CRUD plus per-account balance history, activity and projection.

Balance recording, history, the activity rollup and the balance projection live
here alongside the account routes they hang off (`/api/accounts/{aid}/balance`,
`/{aid}/history`, `/{aid}/activity`, `/{aid}/projection`). The shared
balance-adjustment helpers used by transactions/goals live in
``services/accounts.py``, the projection maths in ``services/projection.py`` and
its database loading in ``services/projection_inputs.py``.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Annotated
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from constants import DEBT_TYPES, ISO_FMT, MAX_DAYS, SUBTYPES_BY_TYPE
from db import db, from_cents, to_cents, utcnow_iso
from auth import require_auth
from schemas import (
    AccountActivityOut,
    AccountIn,
    AccountOut,
    AccountPatch,
    AccountProjectionOut,
    BalanceEntryOut,
    BalanceIn,
    LowBalanceOut,
    OkOut,
    ProjectionEventOut,
    ProjectionHorizonOut,
    ProjectionPointOut,
    ProjectionSummaryOut,
    check_low_balance_threshold,
    validated_institution,
)
from services.accounts import (
    LATEST_BALANCE_JOIN,
    balance_cents_at,
    balance_delta,
    latest_balance_cents,
)
from services.projection import LOW_BALANCE_DAYS, first_below
from services.projection_inputs import Schedule, load_schedule, project_account
from services.transactions import insert_adjustment

router = APIRouter(tags=["accounts"])


def _account_row_to_out(
    row: sqlite3.Row, low_balance: LowBalanceOut | None = None
) -> AccountOut:
    """Map an ``accounts`` row to ``AccountOut``, filling sensible defaults for
    legacy NULLs and surfacing the joined latest balance when present."""
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
        institution=row["institution"],
        institution_name=row["institution_name"],
        currency=row["currency"] or "GBP",
        interest_rate=row["interest_rate"],
        color=row["color"],
        counts_to_net_worth=bool(row["counts_to_net_worth"]),
        closed=bool(row["closed"]),
        created_at=row["created_at"],
        current_balance=from_cents(row["current_balance_cents"])
        if "current_balance_cents" in row.keys()
        else None,
        last_updated=row["last_updated"] if "last_updated" in row.keys() else None,
        low_balance_threshold=from_cents(row["low_balance_threshold_cents"]),
        low_balance=low_balance,
    )


def _threshold_cents(threshold: float | None) -> int | None:
    """A "Warn me below" amount in cents; None (unset) stays None."""
    return None if threshold is None else to_cents(threshold)


def _low_balance(
    row: sqlite3.Row, schedule: Schedule, today: date
) -> LowBalanceOut | None:
    """When an open asset account is projected to close below its threshold
    (zero when unset) in today and the next ``LOW_BALANCE_DAYS``, the first
    such day and its balance; otherwise None. ``row`` carries the joined
    ``current_balance_cents``."""
    if row["closed"] or row["type"] in DEBT_TYPES:
        return None
    projection = project_account(
        row,
        row["current_balance_cents"] or 0,
        schedule,
        today,
        days=LOW_BALANCE_DAYS,
    )
    low = first_below(projection.points, row["low_balance_threshold_cents"] or 0)
    if low is None:
        return None
    return LowBalanceOut(date=low.date.isoformat(), balance=_money(low.balance_cents))


@router.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(uid: int = Depends(require_auth)) -> list[AccountOut]:
    """List the user's accounts, each joined to its most recent balance-history
    entry (current balance + when it was last updated), oldest first.

    Each open asset account also carries ``low_balance`` when its projection
    over the next 30 days dips below its "Warn me below" amount (zero when
    unset). The schedule is loaded once and each account projected over that
    short window, so the list stays one cheap pass per account.
    """
    today = date.today()
    with db() as conn:
        rows = conn.execute(
            f"""
            SELECT a.*,
                   b.balance_cents AS current_balance_cents,
                   b.recorded_at   AS last_updated
            FROM accounts a
            {LATEST_BALANCE_JOIN}
            WHERE a.user_id = ?
            ORDER BY a.created_at
        """,
            (uid,),
        ).fetchall()
        if not rows:
            return []
        schedule = load_schedule(conn, uid, today)
    return [_account_row_to_out(r, _low_balance(r, schedule, today)) for r in rows]


@router.post("/api/accounts", status_code=201, response_model=AccountOut)
def create_account(data: AccountIn, uid: int = Depends(require_auth)) -> AccountOut:
    """Create an account for the user. It starts with no balance history, so the
    returned ``current_balance``/``last_updated`` are None until one is recorded."""
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO accounts(user_id, name, type, subtype, institution, institution_name,"
            " currency, interest_rate, color, counts_to_net_worth, closed,"
            " low_balance_threshold_cents)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                uid,
                data.name,
                data.type,
                data.subtype,
                data.institution,
                data.institution_name,
                data.currency,
                data.interest_rate,
                data.color,
                int(data.counts_to_net_worth),
                int(data.closed),
                _threshold_cents(data.low_balance_threshold),
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _account_row_to_out(row)


def _transfer_currency_clash(
    conn: sqlite3.Connection, aid: int, currency: str
) -> sqlite3.Row | None:
    """A scheduled transfer linking account ``aid`` to an account that isn't
    in ``currency``, with that account's name and currency, or None."""
    row: sqlite3.Row | None = conn.execute(
        "SELECT s.name, o.name AS other_name, o.currency AS other_currency"
        " FROM subscriptions s JOIN accounts o ON o.id = CASE"
        "   WHEN s.account_id = ? THEN s.to_account_id ELSE s.account_id END"
        " WHERE s.kind = 'transfer' AND ? IN (s.account_id, s.to_account_id)"
        "   AND o.currency != ?"
        " ORDER BY s.id LIMIT 1",
        (aid, aid, currency),
    ).fetchone()
    return row


@router.put("/api/accounts/{aid}", response_model=AccountOut)
def update_account(
    aid: int,
    data: AccountPatch,
    uid: int = Depends(require_auth),
) -> AccountOut:
    """Patch the supplied fields of one of the user's accounts (404 if not
    theirs).

    Only non-None fields are applied, except the institution pair and the
    low-balance threshold — nullable columns where clearing is a meaningful edit
    ("no longer recorded", "warn only below zero"), so an explicit null there
    reaches the UPDATE. Type, subtype, institution and threshold are re-checked
    against the row's existing values here because a partial patch may omit the
    other half of each pair, so the schema-level validators can't see them.

    The type may change between accounts that hold money (current, savings,
    invest) or between debts (credit, loan), but not across: the stored balance
    means "held" on one side and "owed" on the other, so switching would flip
    it, and how every later edit to a past transaction moves it. A currency
    change is refused while a scheduled transfer links the account to one in
    another currency, since a transfer needs both sides in the same currency.
    Amounts are never converted: a currency change relabels them.
    """
    with db() as conn:
        existing = conn.execute(
            "SELECT type, subtype, currency, institution, institution_name"
            " FROM accounts WHERE id=? AND user_id=?",
            (aid, uid),
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Not found")
        set_fields = data.model_fields_set
        updates = {
            k: v
            for k, v in data.model_dump(exclude={"low_balance_threshold"}).items()
            if v is not None
        }
        new_type = updates.get("type", existing["type"])
        if (new_type in DEBT_TYPES) != (existing["type"] in DEBT_TYPES):
            raise HTTPException(
                400,
                "An account can't switch between money you hold and money you"
                " owe. Add a new account instead.",
            )
        # Cross-field check: the subtype must be valid for the resulting type.
        # The Pydantic schema can't enforce this on a partial patch, which may
        # carry only one of the two.
        if {"type", "subtype"} & updates.keys():
            subtype = updates.get("subtype", existing["subtype"])
            if subtype not in SUBTYPES_BY_TYPE[new_type]:
                raise HTTPException(
                    400,
                    f"subtype '{subtype}' is not valid for type '{new_type}'",
                )
        if updates.get("currency", existing["currency"]) != existing["currency"]:
            clash = _transfer_currency_clash(conn, aid, updates["currency"])
            if clash:
                raise HTTPException(
                    400,
                    f'"{clash["name"]}" is a scheduled transfer with'
                    f" {clash['other_name']} ({clash['other_currency']}). Both"
                    " accounts in a transfer need the same currency.",
                )
        # Same idea for the institution pair, resolved against the stored row so
        # that patching one half is checked against the other. Writing both
        # columns keeps them coherent — switching from 'other' to a catalogue
        # slug has to drop the now-meaningless custom name.
        if {"institution", "institution_name"} & set_fields:
            slug = (
                data.institution
                if "institution" in set_fields
                else existing["institution"]
            )
            raw_name = (
                data.institution_name
                if "institution_name" in set_fields
                else existing["institution_name"]
            )
            try:
                slug, name = validated_institution(slug, raw_name)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            updates["institution"] = slug
            updates["institution_name"] = name
        if "low_balance_threshold" in set_fields:
            try:
                check_low_balance_threshold(new_type, data.low_balance_threshold)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            updates["low_balance_threshold_cents"] = _threshold_cents(
                data.low_balance_threshold
            )
        if updates:
            sets = ", ".join(f"{k}=?" for k in updates)
            conn.execute(
                f"UPDATE accounts SET {sets} WHERE id=?", [*updates.values(), aid]
            )
            conn.commit()
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (aid,)).fetchone()
    return _account_row_to_out(row)


@router.delete("/api/accounts/{aid}", response_model=OkOut)
def delete_account(aid: int, uid: int = Depends(require_auth)) -> OkOut:
    """Delete one of the user's accounts (404 if not theirs). Linked
    transactions and balance history cascade via the schema's foreign keys."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM accounts WHERE id=?", (aid,))
        conn.commit()
    return OkOut(ok=True)


# ─── Balance history ──────────────────────────────────────────────────────────


@router.post("/api/accounts/{aid}/balance", response_model=OkOut)
def record_balance(
    aid: int,
    data: BalanceIn,
    uid: int = Depends(require_auth),
) -> OkOut:
    """Append a balance-history point for one of the user's accounts (404 if not
    theirs), timestamped now unless the body supplies ``recorded_at``.

    When the account already had a balance at that moment and this one differs,
    the difference is also recorded as a Balance adjustment transaction dated
    then, carrying the note, so a manual change shows in the account's
    transactions. Its amount is the cash flow that would have caused the change
    (``balance_delta``'s debt rule, so owing more on a card reads as money
    out). An account's first balance, or one that matches, records none."""
    with db() as conn:
        account = conn.execute(
            "SELECT type FROM accounts WHERE id=? AND user_id=?", (aid, uid)
        ).fetchone()
        if not account:
            raise HTTPException(404, "Not found")
        ts = data.recorded_at or utcnow_iso()
        new_cents = to_cents(data.balance)
        before_cents = balance_cents_at(conn, aid, ts)
        conn.execute(
            "INSERT INTO balance_history(account_id, balance_cents, notes, recorded_at)"
            " VALUES(?,?,?,?)",
            (aid, new_cents, data.notes, ts),
        )
        if before_cents is not None and new_cents != before_cents:
            insert_adjustment(
                conn,
                uid,
                aid,
                balance_delta(account["type"], new_cents - before_cents),
                ts,
                data.notes or "",
            )
        conn.commit()
    return OkOut(ok=True)


@router.get("/api/accounts/{aid}/history", response_model=list[BalanceEntryOut])
def get_history(
    aid: int,
    days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 90,
    opening: bool = False,
    uid: int = Depends(require_auth),
) -> list[BalanceEntryOut]:
    """Return the balance-history points for one of the user's accounts (404 if
    not theirs) over the last ``days`` (default 90), oldest first.

    With ``opening=true`` the list starts with the balance the account had when
    the window opened: its latest snapshot from before the window, stamped at
    the window's start, so a chart's line begins at the window's edge. Nothing
    is added when no earlier snapshot exists or one sits exactly on the edge.
    """
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(ISO_FMT)
        rows = conn.execute(
            "SELECT balance_cents, notes, recorded_at FROM balance_history"
            " WHERE account_id=? AND recorded_at>=? ORDER BY recorded_at",
            (aid, since),
        ).fetchall()
        before = (
            conn.execute(
                "SELECT balance_cents, notes FROM balance_history"
                " WHERE account_id=? AND recorded_at<?"
                " ORDER BY recorded_at DESC, id DESC LIMIT 1",
                (aid, since),
            ).fetchone()
            if opening and not (rows and rows[0]["recorded_at"] == since)
            else None
        )
    entries = [
        BalanceEntryOut(
            balance=from_cents(r["balance_cents"]) or 0.0,
            notes=r["notes"],
            recorded_at=r["recorded_at"],
        )
        for r in rows
    ]
    if before:
        entries.insert(
            0,
            BalanceEntryOut(
                balance=from_cents(before["balance_cents"]) or 0.0,
                notes=before["notes"],
                recorded_at=since,
            ),
        )
    return entries


# The activity window is "the last N days" on the account page, so it stays
# within a year rather than the decades /history allows.
MAX_ACTIVITY_DAYS = 366


@router.get("/api/accounts/{aid}/activity", response_model=AccountActivityOut)
def get_activity(
    aid: int,
    days: Annotated[int, Query(ge=1, le=MAX_ACTIVITY_DAYS)] = 30,
    uid: int = Depends(require_auth),
) -> AccountActivityOut:
    """Summarise one of the user's accounts (404 if not theirs) over the last
    ``days`` (default 30): how its balance moved since the window opened, and
    how many transactions it took and their totals in each direction.

    The opening balance is the latest snapshot at or before ``since`` — the
    balance the account actually had then — so a snapshot from before the
    window counts, and an account whose history starts inside the window has
    none (and so no ``change``).
    """
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(ISO_FMT)
        opening_cents = balance_cents_at(conn, aid, since)
        current_cents = latest_balance_cents(conn, aid)
        # Balance adjustments are listed (and counted) but aren't money in or
        # out: they correct the balance rather than move money.
        totals = conn.execute(
            "SELECT COUNT(*) AS n,"
            " COALESCE(SUM(CASE WHEN amount_cents > 0 AND adjustment = 0"
            " THEN amount_cents END), 0) AS cin,"
            " COALESCE(SUM(CASE WHEN amount_cents < 0 AND adjustment = 0"
            " THEN -amount_cents END), 0) AS cout"
            " FROM transactions WHERE account_id=? AND user_id=? AND occurred_at>=?",
            (aid, uid, since),
        ).fetchone()
    change_cents = (
        None
        if opening_cents is None
        else (current_cents if current_cents is not None else 0) - opening_cents
    )
    return AccountActivityOut(
        since=since,
        opening_balance=from_cents(opening_cents),
        change=from_cents(change_cents),
        count=totals["n"],
        total_in=from_cents(totals["cin"]) or 0.0,
        total_out=from_cents(totals["cout"]) or 0.0,
    )


# ─── Balance projection ───────────────────────────────────────────────────────

# The account page projects 12 months; the savings Projections window's
# milestones reach 5 years.
MAX_PROJECTION_MONTHS = 60


def _money(cents: int) -> float:
    """Integer cents as money, for the projection's always-present figures."""
    return cents / 100


@router.get("/api/accounts/{aid}/projection", response_model=AccountProjectionOut)
def get_projection(
    aid: int,
    months: Annotated[int, Query(ge=1, le=MAX_PROJECTION_MONTHS)] = 12,
    uid: int = Depends(require_auth),
) -> AccountProjectionOut:
    """Project one of the user's accounts (404 if not theirs) ``months`` ahead
    (default 12) from its latest balance: a closing balance per day, the
    1/3/6/12-month horizons that fit, every scheduled occurrence and interest
    credit with the balance after it, and the low point.

    Uses every active scheduled item touching the account, as its account or as
    a transfer's destination, minus occurrences already handled. Figures are in
    the account's own currency (no FX). Closed accounts still answer.
    """
    today = date.today()
    with db() as conn:
        acct = conn.execute(
            "SELECT id, type, currency, interest_rate FROM accounts"
            " WHERE id=? AND user_id=?",
            (aid, uid),
        ).fetchone()
        if not acct:
            raise HTTPException(404, "Not found")
        start_cents = latest_balance_cents(conn, aid) or 0
        schedule = load_schedule(conn, uid, today, account_id=aid)
    result = project_account(acct, start_cents, schedule, today, months=months)
    summary = result.summary
    return AccountProjectionOut(
        account_id=aid,
        currency=acct["currency"] or "GBP",
        as_of=today.isoformat(),
        start_balance=_money(result.start_balance_cents),
        points=[
            ProjectionPointOut(date=p.date.isoformat(), balance=_money(p.balance_cents))
            for p in result.points
        ],
        horizons=[
            ProjectionHorizonOut(
                months=h.months,
                date=h.date.isoformat(),
                balance=_money(h.balance_cents),
                change=_money(h.change_cents),
            )
            for h in result.horizons
        ],
        events=[
            ProjectionEventOut(
                date=e.date.isoformat(),
                subscription_id=e.subscription_id,
                name=e.name,
                kind=e.kind,
                frequency=e.frequency,
                category=e.category,
                counterparty_name=e.counterparty_name,
                amount=_money(e.amount_cents),
                auto_post=e.auto_post,
                balance_after=_money(e.balance_after_cents),
            )
            for e in result.events
        ],
        summary=ProjectionSummaryOut(
            min_balance=_money(summary.min_balance_cents),
            min_date=summary.min_date.isoformat(),
            first_negative_date=summary.first_negative_date.isoformat()
            if summary.first_negative_date
            else None,
            end_balance=_money(summary.end_balance_cents),
        ),
    )
