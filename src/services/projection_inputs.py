"""Load what the projection engine needs, and run it for one account.

``services/projection`` is pure, so the database side lives here: a User's
scheduled items (joined to both account names) and the occurrences already
posted or skipped. Three readers share it — the account page's
``/api/accounts/{aid}/projection``, the savings Projections window
(``/api/projections``) and the low-balance check on ``GET /api/accounts`` — so
all three give the same figures for the same account. A list read loads the
schedule once and projects every account from it.
"""

import sqlite3
from dataclasses import dataclass
from datetime import date

from services.posting import handled_dates
from services.projection import Projection, ScheduledItem, project


@dataclass(frozen=True)
class Schedule:
    """A User's scheduled items and the ``(subscription_id, date)`` pairs from
    today on that are already handled, ready for ``project``."""

    items: list[ScheduledItem]
    handled: frozenset[tuple[int, date]]


def _scheduled_item(row: sqlite3.Row) -> ScheduledItem:
    """Map a ``subscriptions`` row (joined to both account names) to the
    projection's input."""
    return ScheduledItem(
        id=row["id"],
        name=row["name"],
        kind=row["kind"],
        frequency=row["frequency"],
        category=row["category"] or "",
        amount_cents=row["amount_cents"],
        start_date=date.fromisoformat(row["start_date"]),
        end_date=date.fromisoformat(row["end_date"]) if row["end_date"] else None,
        account_id=row["account_id"],
        to_account_id=row["to_account_id"],
        account_name=row["account_name"],
        to_account_name=row["to_account_name"],
        active=bool(row["active"]),
        auto_post=bool(row["auto_post"]),
    )


def load_schedule(
    conn: sqlite3.Connection,
    uid: int,
    today: date,
    account_id: int | None = None,
) -> Schedule:
    """Every scheduled item of the User's, or only those touching
    ``account_id`` (as its account or a transfer's destination) when given,
    plus their occurrences from ``today`` on that are already handled.

    The engine skips items that don't touch the account it projects, so the
    narrower load is only a saving for a single-account read.
    """
    sql = (
        "SELECT s.*, a.name AS account_name, t.name AS to_account_name"
        " FROM subscriptions s"
        " LEFT JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id"
        " LEFT JOIN accounts t ON t.id = s.to_account_id AND t.user_id = s.user_id"
        " WHERE s.user_id=?"
    )
    params: tuple[int, ...] = (uid,)
    if account_id is not None:
        sql += " AND (s.account_id=? OR s.to_account_id=?)"
        params = (uid, account_id, account_id)
    rows = conn.execute(sql, params).fetchall()
    # Occurrences already posted or skipped are in the balance (or never will
    # be), so the projection leaves them out.
    by_item = handled_dates(conn, uid, [r["id"] for r in rows], start=today)
    return Schedule(
        items=[_scheduled_item(r) for r in rows],
        handled=frozenset((sid, day) for sid, days in by_item.items() for day in days),
    )


def project_account(
    account: sqlite3.Row,
    start_balance_cents: int,
    schedule: Schedule,
    today: date,
    *,
    months: int = 0,
    days: int = 0,
) -> Projection:
    """Project one account (a row with ``id``, ``type`` and ``interest_rate``)
    from ``start_balance_cents`` through ``schedule``, ``months`` and/or
    ``days`` ahead of ``today``."""
    return project(
        account_id=account["id"],
        account_type=account["type"],
        interest_rate=account["interest_rate"],
        start_balance_cents=start_balance_cents,
        items=schedule.items,
        today=today,
        months=months,
        days=days,
        handled=schedule.handled,
    )
