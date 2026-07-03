"""Account-related helpers shared across routers (transactions, goals).

Kept out of the accounts router because transactions and goals depend on them
too; routers must not import one another.
"""

import sqlite3

from fastapi import HTTPException

from db import utcnow_iso


def latest_balance_cents(conn: sqlite3.Connection, account_id: int) -> int | None:
    """Return an account's most-recent balance in integer cents, or None if it
    has no balance history. 'Most recent' is by ``recorded_at``, ties broken by
    the insertion ``id`` so two entries sharing a timestamp stay deterministic."""
    row = conn.execute(
        "SELECT balance_cents FROM balance_history WHERE account_id=?"
        " ORDER BY recorded_at DESC, id DESC LIMIT 1",
        (account_id,),
    ).fetchone()
    return row["balance_cents"] if row else None


# A LEFT JOIN that attaches each account's most-recent balance_history row as
# ``b`` (so callers can read ``b.balance_cents`` / ``b.recorded_at``). Assumes
# the outer query aliases ``accounts`` as ``a``; mirrors the ordering of
# ``latest_balance_cents``. Interpolated into the dashboard/account aggregates
# rather than re-typing the correlated subquery in each.
LATEST_BALANCE_JOIN = (
    "LEFT JOIN balance_history b ON b.id = ("
    " SELECT id FROM balance_history WHERE account_id = a.id"
    " ORDER BY recorded_at DESC, id DESC LIMIT 1"
    ")"
)


def adjust_account_balance(
    conn: sqlite3.Connection, account_id: int, delta_cents: int
) -> None:
    """Add delta_cents to the account's latest balance and record a new entry.

    Debt accounts (``credit``, ``loan``) store their balance as the amount
    owed, which moves opposite to the cashflow sign: an expense increases what's
    owed and income (e.g. a payment or refund) reduces it. The delta is
    inverted for those account types so the stored balance reflects that.
    """
    account = conn.execute(
        "SELECT type FROM accounts WHERE id=?", (account_id,)
    ).fetchone()
    if account and account["type"] in ("credit", "loan"):
        delta_cents = -delta_cents
    current = latest_balance_cents(conn, account_id) or 0
    conn.execute(
        "INSERT INTO balance_history(account_id, balance_cents, recorded_at)"
        " VALUES(?,?,?)",
        (account_id, current + delta_cents, utcnow_iso()),
    )


def require_account(conn: sqlite3.Connection, account_id: int, uid: int) -> None:
    """Raise 404 unless the account exists and belongs to the user."""
    if not conn.execute(
        "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (account_id, uid)
    ).fetchone():
        raise HTTPException(404, "Account not found")


def require_open_account(conn: sqlite3.Connection, account_id: int, uid: int) -> None:
    """Raise 404 unless the account exists and belongs to the user, or 400 if
    it's closed. Closed accounts are kept for history but don't accept new
    transactions, transfers, imports, or subscriptions."""
    row = conn.execute(
        "SELECT closed FROM accounts WHERE id=? AND user_id=?", (account_id, uid)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Account not found")
    if row["closed"]:
        raise HTTPException(400, "Account is closed")
