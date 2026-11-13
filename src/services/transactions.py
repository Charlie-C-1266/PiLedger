"""Transaction and transfer writes shared by the transactions router and the
scheduled-item poster (``services/posting``).

Every row goes in through ``_insert_row``, the one ``INSERT INTO
transactions``. Each public helper pairs it with the balance side effect
through ``adjust_account_balance``, so a transaction can never land without
moving its account (or be removed without moving it back); the exception is a
Balance adjustment, whose balance entry is already written. None commit: the
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


def _insert_row(
    conn: sqlite3.Connection,
    uid: int,
    account_id: int,
    amount_cents: int,
    occurred_at: str,
    merchant: str,
    category: str,
    note: str,
    *,
    transfer_id: Optional[str] = None,
    import_hash: Optional[str] = None,
    adjustment: bool = False,
    balance_history_id: Optional[int] = None,
) -> int:
    """Write one transactions row and return its id — the row only; the
    callers below decide whether it moves the balance. Does not commit."""
    cur = conn.execute(
        "INSERT INTO transactions(user_id, account_id, amount_cents, occurred_at,"
        " merchant, category, note, transfer_id, import_hash, adjustment,"
        " balance_history_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (
            uid,
            account_id,
            amount_cents,
            occurred_at,
            merchant,
            category,
            note,
            transfer_id,
            import_hash,
            int(adjustment),
            balance_history_id,
        ),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def insert_transaction(
    conn: sqlite3.Connection,
    uid: int,
    account_id: int,
    amount_cents: int,
    occurred_at: str,
    merchant: str,
    category: str,
    note: str,
    *,
    import_hash: Optional[str] = None,
) -> int:
    """Insert one transaction and apply its signed amount to the account's
    balance. Returns the new transaction id. Does not commit.

    ``import_hash`` marks a CSV-imported row; its unique index makes a row
    already imported raise ``sqlite3.IntegrityError`` before the balance moves,
    which the import counts as a duplicate."""
    tid = _insert_row(
        conn,
        uid,
        account_id,
        amount_cents,
        occurred_at,
        merchant,
        category,
        note,
        import_hash=import_hash,
    )
    adjust_account_balance(conn, account_id, amount_cents)
    return tid


def insert_adjustment(
    conn: sqlite3.Connection,
    uid: int,
    account_id: int,
    amount_cents: int,
    occurred_at: str,
    note: str,
    balance_history_id: int,
) -> int:
    """Record a Balance adjustment: the cash flow a manual balance update made,
    flagged ``adjustment = 1`` and linked to the balance-history entry
    (``balance_history_id``) the update wrote. Unlike ``insert_transaction`` it
    does *not* move the balance, because that entry has already set it; the row
    is the visible record of that change. Deleting it later goes through
    ``delete_transaction_legs``, which undoes the update. Returns the new id.
    Does not commit."""
    return _insert_row(
        conn,
        uid,
        account_id,
        amount_cents,
        occurred_at,
        ADJUSTMENT_MERCHANT,
        ADJUSTMENT_CATEGORY,
        note,
        adjustment=True,
        balance_history_id=balance_history_id,
    )


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
        ids.append(
            _insert_row(
                conn,
                uid,
                account_id,
                signed,
                occurred_at,
                merchant,
                category,
                note,
                transfer_id=transfer_id,
            )
        )
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
    effect. A Balance adjustment from a backdated update that didn't change the
    current balance is undone by removing its balance entry instead (see
    ``_backfilled_entry``). Rows already gone are simply not found, so this is
    safe to call for a posting whose transaction the user has since deleted.
    Returns how many rows were removed. Does not commit."""
    if transfer_id is None and transaction_id is not None:
        row = conn.execute(
            "SELECT transfer_id FROM transactions WHERE id=? AND user_id=?",
            (transaction_id, uid),
        ).fetchone()
        if row is not None:
            transfer_id = row["transfer_id"]
    columns = "id, account_id, amount_cents, adjustment, balance_history_id"
    if transfer_id is not None:
        legs = conn.execute(
            f"SELECT {columns} FROM transactions WHERE transfer_id=? AND user_id=?",
            (transfer_id, uid),
        ).fetchall()
    elif transaction_id is not None:
        legs = conn.execute(
            f"SELECT {columns} FROM transactions WHERE id=? AND user_id=?",
            (transaction_id, uid),
        ).fetchall()
    else:
        legs = []
    for leg in legs:
        backfilled = _backfilled_entry(conn, leg)
        if backfilled is not None:
            conn.execute("DELETE FROM balance_history WHERE id=?", (backfilled,))
        else:
            adjust_account_balance(conn, leg["account_id"], -leg["amount_cents"])
        conn.execute("DELETE FROM transactions WHERE id=?", (leg["id"],))
    return len(legs)


def _backfilled_entry(conn: sqlite3.Connection, leg: sqlite3.Row) -> Optional[int]:
    """The balance entry behind a Balance adjustment whose update was a
    backfill, or None for any other row.

    A balance update dated before an entry the account already had corrects the
    history but leaves the current balance alone (the later entry still wins),
    so reversing its adjustment against the current balance would invent a
    change. Undoing it means removing the entry it wrote. An entry is a
    backfill when some entry dated after it was recorded before it (smaller
    ``id``): at the time, it wasn't the latest. An update that was the latest
    did move the current balance, and later transactions build on it, so its
    adjustment is reversed like any other transaction."""
    if not leg["adjustment"] or leg["balance_history_id"] is None:
        return None
    entry = conn.execute(
        "SELECT id, account_id, recorded_at FROM balance_history WHERE id=?",
        (leg["balance_history_id"],),
    ).fetchone()
    if entry is None:
        return None
    later = conn.execute(
        "SELECT 1 FROM balance_history"
        " WHERE account_id=? AND recorded_at>? AND id<? LIMIT 1",
        (entry["account_id"], entry["recorded_at"], entry["id"]),
    ).fetchone()
    return entry["id"] if later else None
