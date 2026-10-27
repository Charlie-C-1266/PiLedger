"""Matching CSV import rows to transactions a schedule already posted.

A scheduled item that posts itself (``services/posting``) creates its
transaction on the due date. When the user later imports the bank's CSV, the
same payment arrives a second time. So before an import inserts anything, each
row is checked against the account's transactions that came from a schedule —
linked from a ``posted`` row of the posting log — and that no import has
claimed yet (``import_hash`` still NULL).

A row matches one of them when the signed amount is identical and the dates are
at most ``MATCH_WINDOW_DAYS`` apart. Matching is one-to-one: the closest pair is
taken first, and on a tie the earlier transaction wins. A different amount (a
variable bill) never matches. A row whose ``import_hash`` already exists was
imported before; the import skips it as a duplicate, so it takes no part here.

Claiming a match turns the posted transaction into the imported row: it takes
the row's hash (so re-importing the file skips it) and the bank's date and
description. The amount is identical, so the balance doesn't move.

``match_rows`` is pure; ``find_matches`` loads the candidates and runs it;
``claim_transaction`` applies one match. None of them commit.
"""

import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional, Sequence

# How far apart (in days, either way) a bank row and a posted transaction may
# be and still match: banks often settle a day or two after the due date.
MATCH_WINDOW_DAYS = 3


@dataclass(frozen=True)
class ImportRow:
    """One parsed CSV row, as matching sees it."""

    row: int  # 1-based data row number, as in the import's error list
    day: date
    amount_cents: int
    import_hash: str


@dataclass(frozen=True)
class ScheduledTxn:
    """A transaction a scheduled item posted, not yet claimed by an import."""

    transaction_id: int
    day: date
    amount_cents: int
    name: str  # the scheduled item's name
    transfer_id: Optional[str]


def match_rows(
    rows: Sequence[ImportRow], candidates: Sequence[ScheduledTxn]
) -> dict[int, ScheduledTxn]:
    """Pair rows with candidates one-to-one; returns row number -> match.

    A pair needs the same signed amount and dates at most ``MATCH_WINDOW_DAYS``
    apart. The nearest pairs are taken first; on equal distance the earlier
    transaction wins (then the lower id, then the earlier row), so the result
    never depends on input order. Pure — no DB.
    """
    by_amount: defaultdict[int, list[ScheduledTxn]] = defaultdict(list)
    for c in candidates:
        by_amount[c.amount_cents].append(c)

    pairs: list[tuple[int, date, int, date, int, ScheduledTxn]] = []
    for r in rows:
        for c in by_amount.get(r.amount_cents, ()):
            gap = abs((c.day - r.day).days)
            if gap <= MATCH_WINDOW_DAYS:
                pairs.append((gap, c.day, c.transaction_id, r.day, r.row, c))
    pairs.sort(key=lambda p: p[:5])

    matched: dict[int, ScheduledTxn] = {}
    taken: set[int] = set()
    for _, _, tid, _, row, c in pairs:
        if row in matched or tid in taken:
            continue
        matched[row] = c
        taken.add(tid)
    return matched


def scheduled_candidates(
    conn: sqlite3.Connection, uid: int, account_id: int, start: date, end: date
) -> list[ScheduledTxn]:
    """The account's schedule-posted transactions dated in ``[start, end]``
    that no import has claimed. A plain posting links its transaction by id; a
    scheduled transfer links both legs by ``transfer_id``, so either leg can
    match an import into its own account."""
    cols = (
        "SELECT t.id, t.occurred_at, t.amount_cents, t.transfer_id, s.name"
        " FROM transactions t"
    )
    where = (
        " JOIN subscriptions s ON s.id = p.subscription_id"
        " WHERE p.status = 'posted' AND p.user_id = ?"
        " AND t.user_id = ? AND t.account_id = ? AND t.import_hash IS NULL"
        " AND substr(t.occurred_at, 1, 10) BETWEEN ? AND ?"
    )
    params = (uid, uid, account_id, start.isoformat(), end.isoformat())
    rows = conn.execute(
        f"{cols} JOIN subscription_postings p ON p.transaction_id = t.id{where}"
        f" UNION {cols} JOIN subscription_postings p"
        f" ON t.transfer_id IS NOT NULL AND p.transfer_id = t.transfer_id{where}",
        params + params,
    ).fetchall()
    return [
        ScheduledTxn(
            transaction_id=r["id"],
            day=date.fromisoformat(r["occurred_at"][:10]),
            amount_cents=r["amount_cents"],
            name=r["name"],
            transfer_id=r["transfer_id"],
        )
        for r in rows
    ]


def find_matches(
    conn: sqlite3.Connection, uid: int, account_id: int, rows: Sequence[ImportRow]
) -> dict[int, ScheduledTxn]:
    """Match an import's rows to the account's schedule-posted transactions;
    returns row number -> match. Rows already imported (their hash exists)
    are left out, since the import skips them anyway."""
    imported = {
        r["import_hash"]
        for r in conn.execute(
            "SELECT import_hash FROM transactions"
            " WHERE user_id=? AND account_id=? AND import_hash IS NOT NULL",
            (uid, account_id),
        )
    }
    fresh = [r for r in rows if r.import_hash not in imported]
    if not fresh:
        return {}
    window = timedelta(days=MATCH_WINDOW_DAYS)
    candidates = scheduled_candidates(
        conn,
        uid,
        account_id,
        min(r.day for r in fresh) - window,
        max(r.day for r in fresh) + window,
    )
    return match_rows(fresh, candidates)


def claim_transaction(
    conn: sqlite3.Connection,
    uid: int,
    match: ScheduledTxn,
    import_hash: str,
    occurred_at: str,
    merchant: str,
) -> bool:
    """Make a matched transaction the imported row: stamp the row's hash and
    take the bank's date and description. A transfer leg only takes the hash,
    because transfers can't be edited and both legs keep one date. Returns
    False if an import claimed it first. Raises ``sqlite3.IntegrityError`` if
    the hash is already on another transaction."""
    if match.transfer_id is not None:
        cur = conn.execute(
            "UPDATE transactions SET import_hash=?"
            " WHERE id=? AND user_id=? AND import_hash IS NULL",
            (import_hash, match.transaction_id, uid),
        )
    else:
        cur = conn.execute(
            "UPDATE transactions SET import_hash=?, occurred_at=?, merchant=?"
            " WHERE id=? AND user_id=? AND import_hash IS NULL",
            (import_hash, occurred_at, merchant, match.transaction_id, uid),
        )
    return cur.rowcount == 1
