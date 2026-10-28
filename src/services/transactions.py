"""Transaction and transfer writes shared by the transactions router and the
scheduled-item poster (``services/posting``).

Each helper does the insert *and* the balance side effect through
``adjust_account_balance``, so a transaction can never land without moving its
account (or be removed without moving it back). None of them commit: the
caller owns the SQLite transaction, which lets the poster write a posting-log
row and its transaction atomically. Validation (ownership, closed accounts,
currencies) stays with the callers, because the router answers bad input with
an HTTP error while the poster skips the item and logs a warning.
"""

import sqlite3
import uuid
from typing import Optional

from constants import ADJUSTMENT_CATEGORY, ADJUSTMENT_MERCHANT
from services.accounts import adjust_account_balance

# Every read of transactions that is returned through the API goes through this
# SELECT so each row carries the scheduled item that posted it (or NULL).
# Equivalent to a LEFT JOIN on the posting log, written as two scalar lookups —
# one per link column, each backed by its own index — so a row can never be
# duplicated by the join: a plain transaction is matched on `transaction_id`,
# either leg of a transfer on `transfer_id`. Callers append WHERE/ORDER BY;
# unqualified column names still resolve to `transactions`.
TXN_SELECT = (
    "SELECT transactions.*, COALESCE("
    "(SELECT p.subscription_id FROM subscription_postings p"
    " WHERE p.transaction_id = transactions.id),"
    "(SELECT p.subscription_id FROM subscription_postings p"
    " WHERE transactions.transfer_id IS NOT NULL"
    " AND p.transfer_id = transactions.transfer_id)"
    ") AS subscription_id FROM transactions"
)


def insert_transaction(
    conn: sqlite3.Connection,
    uid: int,
    account_id: int,
    amount_cents: int,
    occurred_at: str,
    merchant: str,
    category: str,
    note: str,
) -> int:
    """Insert one transaction and apply its signed amount to the account's
    balance. Returns the new transaction id. Does not commit."""
    cur = conn.execute(
        "INSERT INTO transactions(user_id, account_id, amount_cents,"
        " occurred_at, merchant, category, note) VALUES(?,?,?,?,?,?,?)",
        (uid, account_id, amount_cents, occurred_at, merchant, category, note),
    )
    adjust_account_balance(conn, account_id, amount_cents)
    assert cur.lastrowid is not None
    return cur.lastrowid


def insert_adjustment(
    conn: sqlite3.Connection,
    uid: int,
    account_id: int,
    amount_cents: int,
    occurred_at: str,
    note: str,
) -> int:
    """Record a Balance adjustment: the cash flow a manual balance update made,
    flagged ``adjustment = 1``. Unlike ``insert_transaction`` it does *not*
    move the balance, because the balance-history entry the update wrote has
    already set it; the row is the visible record of that change. Deleting it
    later goes through ``delete_transaction_legs`` like any other row, which
    reverses it. Returns the new id. Does not commit."""
    cur = conn.execute(
        "INSERT INTO transactions(user_id, account_id, amount_cents,"
        " occurred_at, merchant, category, note, adjustment)"
        " VALUES(?,?,?,?,?,?,?,1)",
        (
            uid,
            account_id,
            amount_cents,
            occurred_at,
            ADJUSTMENT_MERCHANT,
            ADJUSTMENT_CATEGORY,
            note,
        ),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def insert_transfer(
    conn: sqlite3.Connection,
    uid: int,
    from_account_id: int,
    to_account_id: int,
    amount_cents: int,
    occurred_at: str,
    note: str,
    merchants: tuple[str, str],
    category: str = "Transfer",
) -> tuple[str, list[int]]:
    """Insert a transfer as two linked legs sharing a fresh ``transfer_id`` —
    ``-amount_cents`` on the source, ``+amount_cents`` on the destination — and
    move both balances. ``merchants`` names the (source, destination) legs.
    Returns ``(transfer_id, [source_leg_id, destination_leg_id])``. Does not
    commit."""
    transfer_id = uuid.uuid4().hex
    ids: list[int] = []
    for account_id, signed, merchant in (
        (from_account_id, -amount_cents, merchants[0]),
        (to_account_id, amount_cents, merchants[1]),
    ):
        cur = conn.execute(
            "INSERT INTO transactions(user_id, account_id, amount_cents,"
            " occurred_at, merchant, category, note, transfer_id)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (
                uid,
                account_id,
                signed,
                occurred_at,
                merchant,
                category,
                note,
                transfer_id,
            ),
        )
        assert cur.lastrowid is not None
        ids.append(cur.lastrowid)
        adjust_account_balance(conn, account_id, signed)
    return transfer_id, ids


def delete_transaction_legs(
    conn: sqlite3.Connection,
    uid: int,
    transaction_id: Optional[int] = None,
    transfer_id: Optional[str] = None,
) -> int:
    """Delete a transaction — or, given a ``transfer_id`` (or a transaction that
    is a transfer leg), both legs of that transfer — reversing each balance
    effect. Rows already gone are simply not found, so this is safe to call for
    a posting whose transaction the user has since deleted. Returns how many
    rows were removed. Does not commit."""
    if transfer_id is None and transaction_id is not None:
        row = conn.execute(
            "SELECT transfer_id FROM transactions WHERE id=? AND user_id=?",
            (transaction_id, uid),
        ).fetchone()
        if row is not None:
            transfer_id = row["transfer_id"]
    if transfer_id is not None:
        legs = conn.execute(
            "SELECT id, account_id, amount_cents FROM transactions"
            " WHERE transfer_id=? AND user_id=?",
            (transfer_id, uid),
        ).fetchall()
    elif transaction_id is not None:
        legs = conn.execute(
            "SELECT id, account_id, amount_cents FROM transactions"
            " WHERE id=? AND user_id=?",
            (transaction_id, uid),
        ).fetchall()
    else:
        legs = []
    for leg in legs:
        adjust_account_balance(conn, leg["account_id"], -leg["amount_cents"])
        conn.execute("DELETE FROM transactions WHERE id=?", (leg["id"],))
    return len(legs)
