"""Posting scheduled items: turning their occurrences into real transactions.

A scheduled item (a ``subscriptions`` row) with ``auto_post`` on creates one
Transaction — or, for a transfer, one Transfer — per due date, from
``auto_post_from`` (the day auto-post was switched on, so switching it on never
back-fills the past) up to today. Occurrences missed while the server was off
are caught up on the next run.

The ``subscription_postings`` log is what keeps this exactly-once. Each handled
occurrence gets one row, unique on ``(subscription_id, occurrence_date)``:
``posted`` (linked to the transaction it created) or ``skipped``. The poster
writes that row first with ``INSERT OR IGNORE`` and only creates the
transaction if the row inserted, inside one SQLite transaction — so two
overlapping runs can't both post a date, and a crash can't leave a transaction
without its log row. The row outlives a deleted transaction (its link is
``ON DELETE SET NULL``), so deleting an auto-posted transaction never brings it
back.

Posted transactions are ordinary rows: dated on the occurrence (midnight UTC,
like a CSV import), named after the item, in its category, with a short note.
The same log backs the per-occurrence controls (Post now / Skip / Undo) and,
through ``handled_dates``, keeps handled dates out of the scheduled views and
the balance projection.

``due_dates`` is pure; everything else takes an open connection and owns its
SQLite transactions (``write_transaction``), committing per occurrence.
"""

import logging
import sqlite3
from contextlib import contextmanager
from datetime import date
from typing import Iterable, Iterator, Optional

from db import db
from services.subscriptions import occurrences_between
from services.transactions import (
    delete_transaction_legs,
    insert_transaction,
    insert_transfer,
)

log = logging.getLogger("piledger.autopost")

# The note on a transaction the daily run created, and on one created by "Post
# now" (which the user asked for, so it isn't "automatic").
AUTO_POST_NOTE = "Posted automatically"
POST_NOW_NOTE = "Posted from schedule"

# A manual transfer's legs land in this category; a scheduled transfer with no
# category of its own does too, so it stays out of spending the same way.
_TRANSFER_CATEGORY = "Transfer"


class PostingError(Exception):
    """An item can't be posted right now (e.g. its account is closed). The
    message is user-facing; the routers return it as a 400."""


def occurred_at_for(day: date) -> str:
    """The transaction timestamp for a date-only posting: midnight UTC on
    ``day`` in ``ISO_FMT`` — the same stamp a CSV import gives a bank row."""
    return f"{day.isoformat()}T00:00:00Z"


def due_dates(
    start: date,
    frequency: str,
    end: Optional[date],
    auto_post_from: Optional[date],
    today: date,
    handled: Iterable[date] = (),
) -> list[date]:
    """The occurrences an auto-posting item still owes: every due date in
    ``[auto_post_from, today]`` (and within the item's own start/end) that
    isn't already in the posting log. Pure — no clock, no DB. Nothing is due
    before ``auto_post_from`` (no back-fill) or when it is unset."""
    if auto_post_from is None or today < auto_post_from:
        return []
    done = set(handled)
    return [
        d
        for d in occurrences_between(start, frequency, end, auto_post_from, today)
        if d not in done
    ]


def is_occurrence(start: date, frequency: str, end: Optional[date], day: date) -> bool:
    """Whether ``day`` is one of the item's real due dates (on or after its
    start, not past its end, on its stride)."""
    return occurrences_between(start, frequency, end, day, day) == [day]


def item_schedule(sub: sqlite3.Row) -> tuple[date, str, Optional[date]]:
    """A subscriptions row's ``(start, frequency, end)`` as dates."""
    end = date.fromisoformat(sub["end_date"]) if sub["end_date"] else None
    return date.fromisoformat(sub["start_date"]), sub["frequency"], end


# ─── Reading the log ──────────────────────────────────────────────────────────


def posting_statuses(
    conn: sqlite3.Connection,
    uid: int,
    subscription_ids: Iterable[int],
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> dict[int, dict[date, str]]:
    """Each item's handled occurrences mapped to their status (``posted`` or
    ``skipped``), optionally limited to dates in ``[start, end]``. Every id
    asked for gets an entry, empty when nothing is logged."""
    ids = list(dict.fromkeys(subscription_ids))
    out: dict[int, dict[date, str]] = {sid: {} for sid in ids}
    if not ids:
        return out
    sql = (
        "SELECT subscription_id, occurrence_date, status FROM subscription_postings"
        f" WHERE user_id=? AND subscription_id IN ({','.join('?' * len(ids))})"
    )
    params: list[object] = [uid, *ids]
    if start is not None:
        sql += " AND occurrence_date >= ?"
        params.append(start.isoformat())
    if end is not None:
        sql += " AND occurrence_date <= ?"
        params.append(end.isoformat())
    for r in conn.execute(sql, params).fetchall():
        out[r["subscription_id"]][date.fromisoformat(r["occurrence_date"])] = r[
            "status"
        ]
    return out


def handled_dates(
    conn: sqlite3.Connection,
    uid: int,
    subscription_ids: Iterable[int],
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> dict[int, set[date]]:
    """Each item's occurrence dates that are already posted or skipped — the
    dates a schedule view or projection must leave out. Same filtering as
    ``posting_statuses``."""
    return {
        sid: set(by_date)
        for sid, by_date in posting_statuses(
            conn, uid, subscription_ids, start, end
        ).items()
    }


def get_posting(conn: sqlite3.Connection, sid: int, day: date) -> Optional[sqlite3.Row]:
    """The log row for one occurrence of an item, or None."""
    row: Optional[sqlite3.Row] = conn.execute(
        "SELECT * FROM subscription_postings"
        " WHERE subscription_id=? AND occurrence_date=?",
        (sid, day.isoformat()),
    ).fetchone()
    return row


# ─── Writing ──────────────────────────────────────────────────────────────────


@contextmanager
def write_transaction(conn: sqlite3.Connection) -> Iterator[None]:
    """Run the block as one SQLite write transaction, committed on success and
    rolled back on any error. ``BEGIN IMMEDIATE`` takes the write lock up front
    (waiting out ``busy_timeout``), so a check-then-write inside the block
    can't race another run. If the caller already has a transaction open, the
    block joins it and the caller commits."""
    began = not conn.in_transaction
    if began:
        conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        if began:
            conn.rollback()
        raise
    if began:
        conn.commit()


def unpostable_reason(conn: sqlite3.Connection, sub: sqlite3.Row) -> Optional[str]:
    """Why ``sub`` can't post a transaction right now, or None if it can.

    An expense or income needs its linked account; a transfer needs both ends,
    different from each other and in one currency. Every account must still be
    the user's and open — a closed account takes no new activity.
    """
    ids = [sub["account_id"]]
    if sub["kind"] == "transfer":
        ids.append(sub["to_account_id"])
    if any(i is None for i in ids):
        return "Link an account before posting this item"
    if len(set(ids)) != len(ids):
        return "Cannot transfer to the same account"
    rows = conn.execute(
        "SELECT closed, currency FROM accounts"
        f" WHERE user_id=? AND id IN ({','.join('?' * len(ids))})",
        [sub["user_id"], *ids],
    ).fetchall()
    if len(rows) != len(ids):
        return "Account not found"
    if any(r["closed"] for r in rows):
        return "Account is closed"
    if len({r["currency"] or "GBP" for r in rows}) != 1:
        return "Transfers between accounts of different currencies are not supported"
    return None


def _create_transaction(
    conn: sqlite3.Connection, sub: sqlite3.Row, occurred_at: str, note: str
) -> tuple[Optional[int], Optional[str]]:
    """Create the Transaction (or Transfer) for one occurrence of ``sub``.
    Returns ``(transaction_id, transfer_id)`` — one of them set. Signs: an
    expense is negative on its account, income positive, and a transfer moves
    the amount from ``account_id`` to ``to_account_id``; credit/loan balances
    are inverted downstream by ``adjust_account_balance``."""
    amount = sub["amount_cents"]
    uid = sub["user_id"]
    if sub["kind"] == "transfer":
        transfer_id, _ = insert_transfer(
            conn,
            uid,
            sub["account_id"],
            sub["to_account_id"],
            amount,
            occurred_at,
            note,
            (sub["name"], sub["name"]),
            category=sub["category"] or _TRANSFER_CATEGORY,
        )
        return None, transfer_id
    signed = amount if sub["kind"] == "income" else -amount
    tid = insert_transaction(
        conn,
        uid,
        sub["account_id"],
        signed,
        occurred_at,
        sub["name"],
        sub["category"],
        note,
    )
    return tid, None


def post_occurrence(
    conn: sqlite3.Connection, sub: sqlite3.Row, day: date, note: str = AUTO_POST_NOTE
) -> bool:
    """Post one occurrence of ``sub`` dated on ``day``, exactly once.

    In one SQLite transaction: claim the date with ``INSERT OR IGNORE`` into
    the log, and only if that inserted create the transaction and stamp its
    id. Returns whether anything was posted (False when the date was already
    handled). The caller checks the accounts first (``unpostable_reason``).
    """
    with write_transaction(conn):
        cur = conn.execute(
            "INSERT OR IGNORE INTO subscription_postings"
            "(user_id, subscription_id, occurrence_date, status)"
            " VALUES(?,?,?,'posted')",
            (sub["user_id"], sub["id"], day.isoformat()),
        )
        if cur.rowcount != 1:
            return False
        tid, transfer_id = _create_transaction(conn, sub, occurred_at_for(day), note)
        conn.execute(
            "UPDATE subscription_postings SET transaction_id=?, transfer_id=?"
            " WHERE id=?",
            (tid, transfer_id, cur.lastrowid),
        )
    return True


def post_due(conn: sqlite3.Connection, today: date, uid: Optional[int] = None) -> int:
    """Post every occurrence that auto-posting items owe up to ``today`` — for
    one user, or everyone when ``uid`` is None. Returns how many were posted.

    Idempotent: dates already in the log are skipped, and the log's unique key
    stops an overlapping run from posting a date twice. Paused items post
    nothing; nothing past an item's end date or before its ``auto_post_from``
    is due. An item whose account is unlinked, gone or closed is skipped with a
    warning and left as it is (no auto-pause), so it resumes once fixed. An
    error on one item is logged and doesn't stop the others.
    """
    sql = "SELECT * FROM subscriptions WHERE auto_post=1 AND active=1"
    params: list[int] = []
    if uid is not None:
        sql += " AND user_id=?"
        params.append(uid)
    posted = 0
    for sub in conn.execute(sql + " ORDER BY id", params).fetchall():
        try:
            posted += _post_item(conn, sub, today)
        except Exception:
            log.exception(
                "auto-post failed for scheduled item %s (user %s)",
                sub["id"],
                sub["user_id"],
            )
    return posted


def _post_item(conn: sqlite3.Connection, sub: sqlite3.Row, today: date) -> int:
    """Post one auto-posting item's due dates; returns how many were posted."""
    start, frequency, end = item_schedule(sub)
    auto_post_from = (
        date.fromisoformat(sub["auto_post_from"]) if sub["auto_post_from"] else None
    )
    handled = handled_dates(conn, sub["user_id"], [sub["id"]], start=auto_post_from)
    dates = due_dates(start, frequency, end, auto_post_from, today, handled[sub["id"]])
    if not dates:
        return 0
    reason = unpostable_reason(conn, sub)
    if reason is not None:
        log.warning(
            "auto-post skipped scheduled item %s (user %s): %s",
            sub["id"],
            sub["user_id"],
            reason,
        )
        return 0
    return sum(post_occurrence(conn, sub, d) for d in dates)


def post_due_for_everyone() -> int:
    """One auto-post run over every user, dated on the server's local today —
    what the startup catch-up and the daily timer call. Opens its own
    connection (it runs in a worker thread) and logs the outcome."""
    with db() as conn:
        posted = post_due(conn, date.today())
    log.info("auto-post run posted %d occurrence(s)", posted)
    return posted


# ─── Per-occurrence control ──────────────────────────────────────────────────


def post_now(
    conn: sqlite3.Connection, sub: sqlite3.Row, day: date, today: date
) -> sqlite3.Row:
    """Post now: create the transaction for occurrence ``day`` dated
    ``today``, and record ``day`` as posted. Idempotent — an already-posted date
    is left alone (even if its transaction was since deleted); a skipped one
    becomes posted. Raises ``PostingError`` when the item can't post (see
    ``unpostable_reason``). Returns the log row."""
    with write_transaction(conn):
        existing = get_posting(conn, sub["id"], day)
        if existing is None or existing["status"] != "posted":
            reason = unpostable_reason(conn, sub)
            if reason is not None:
                raise PostingError(reason)
            tid, transfer_id = _create_transaction(
                conn, sub, occurred_at_for(today), POST_NOW_NOTE
            )
            if existing is None:
                conn.execute(
                    "INSERT INTO subscription_postings(user_id, subscription_id,"
                    " occurrence_date, status, transaction_id, transfer_id)"
                    " VALUES(?,?,?,'posted',?,?)",
                    (sub["user_id"], sub["id"], day.isoformat(), tid, transfer_id),
                )
            else:
                conn.execute(
                    "UPDATE subscription_postings SET status='posted',"
                    " transaction_id=?, transfer_id=? WHERE id=?",
                    (tid, transfer_id, existing["id"]),
                )
        row = get_posting(conn, sub["id"], day)
    assert row is not None
    return row


def skip_occurrence(
    conn: sqlite3.Connection, uid: int, sid: int, day: date
) -> sqlite3.Row:
    """Skip this one: record occurrence ``day`` as skipped so nothing posts
    for it. If it was already posted, its transaction (or both transfer legs)
    is deleted first, reversing the balance. Idempotent. Returns the log row."""
    with write_transaction(conn):
        existing = get_posting(conn, sid, day)
        if existing is None:
            conn.execute(
                "INSERT INTO subscription_postings(user_id, subscription_id,"
                " occurrence_date, status) VALUES(?,?,?,'skipped')",
                (uid, sid, day.isoformat()),
            )
        elif existing["status"] == "posted":
            delete_transaction_legs(
                conn, uid, existing["transaction_id"], existing["transfer_id"]
            )
            conn.execute(
                "UPDATE subscription_postings SET status='skipped',"
                " transaction_id=NULL, transfer_id=NULL WHERE id=?",
                (existing["id"],),
            )
        row = get_posting(conn, sid, day)
    assert row is not None
    return row


def undo_posting(conn: sqlite3.Connection, uid: int, sid: int, day: date) -> bool:
    """Undo: forget that occurrence ``day`` was handled — delete its log row
    and any transaction (or transfer) it created, reversing the balance. The
    date is then due again, so an auto-posting item posts it on its next run
    if it has passed. Returns False when there was nothing to undo."""
    with write_transaction(conn):
        existing = get_posting(conn, sid, day)
        if existing is None:
            return False
        if existing["status"] == "posted":
            delete_transaction_legs(
                conn, uid, existing["transaction_id"], existing["transfer_id"]
            )
        conn.execute("DELETE FROM subscription_postings WHERE id=?", (existing["id"],))
    return True
