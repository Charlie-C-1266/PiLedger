"""Scheduled items (stored as ``subscriptions``) — reminder-only for now.

A scheduled item never posts a transaction; it records a recurring payment,
income or transfer so the app can surface upcoming due dates as a time-ordered
list and a month calendar. The table and the ``/api/subscriptions`` paths keep
their original name because API-token and MCP clients depend on them; only the
screen is called "Scheduled". ``next_due_date`` is computed on read (never
stored) so an elapsed row can't go stale, and the calendar window is expanded
server-side via ``services/subscriptions`` so the frontend does no recurrence
math.

``kind`` decides what the account links mean (see ``_check_links``): an expense
or income may name one account, and a transfer must name two different accounts
of the user's that share a currency. ``amount`` is always positive.
"""

from datetime import date
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db import db, from_cents, to_cents
from auth import require_auth
from schemas import (
    OkOut,
    SubscriptionIn,
    SubscriptionOccurrenceOut,
    SubscriptionOut,
    SubscriptionPatch,
)
from services.accounts import require_account
from services.subscriptions import next_occurrence, occurrences_between

router = APIRouter(tags=["subscriptions"])

# A calendar request can't expand an unbounded window — caps the per-row
# occurrence loop. A year of months comfortably covers any month-grid view.
_MAX_WINDOW_DAYS = 366

# The ?account= filter matches either end of a transfer, so an account's list
# shows money scheduled to leave it and to arrive in it.
_ACCOUNT_FILTER = " AND (account_id=? OR to_account_id=?)"


def _check_links(
    conn: sqlite3.Connection,
    uid: int,
    kind: str,
    account_id: Optional[int],
    to_account_id: Optional[int],
) -> None:
    """Enforce the kind ↔ account rules for a scheduled item about to be saved.

    A transfer needs a from and a to account that differ, both owned by the user
    (404 otherwise) and sharing a currency (400, the same rule as
    ``POST /api/transfers``). An expense or income may link one account (404 if
    it isn't the user's) and must not name a destination (400).
    """
    if kind != "transfer":
        if to_account_id is not None:
            raise HTTPException(400, "Only a transfer can have a to account")
        if account_id is not None:
            require_account(conn, account_id, uid)
        return
    if account_id is None or to_account_id is None:
        raise HTTPException(400, "A transfer needs both a from and a to account")
    if account_id == to_account_id:
        raise HTTPException(400, "Cannot transfer to the same account")
    require_account(conn, account_id, uid)
    require_account(conn, to_account_id, uid)
    currencies = {
        r["currency"] or "GBP"
        for r in conn.execute(
            "SELECT currency FROM accounts WHERE id IN (?, ?)",
            (account_id, to_account_id),
        ).fetchall()
    }
    if len(currencies) != 1:
        raise HTTPException(
            400,
            "Transfers between accounts of different currencies are not supported",
        )


def _account_name(
    conn: sqlite3.Connection, account_id: Optional[int], uid: int
) -> Optional[str]:
    """The name of one of the user's accounts, or None when unlinked or the
    account is gone."""
    if account_id is None:
        return None
    acc = conn.execute(
        "SELECT name FROM accounts WHERE id=? AND user_id=?", (account_id, uid)
    ).fetchone()
    return acc["name"] if acc else None


def _subscription_row_to_out(
    conn: sqlite3.Connection, row: sqlite3.Row, today: date
) -> SubscriptionOut:
    """Build a SubscriptionOut, resolving both linked account names and
    computing ``next_due_date`` (the next occurrence on/after ``today``). A link
    to a since-deleted account reports as unlinked; an inactive or elapsed-past-
    ``end_date`` subscription reports no next due date."""
    account_name = _account_name(conn, row["account_id"], row["user_id"])
    account_id = row["account_id"] if account_name is not None else None
    to_account_name = _account_name(conn, row["to_account_id"], row["user_id"])
    to_account_id = row["to_account_id"] if to_account_name is not None else None
    start = date.fromisoformat(row["start_date"])
    end = date.fromisoformat(row["end_date"]) if row["end_date"] else None
    next_due = None
    if row["active"]:
        nxt = next_occurrence(start, row["frequency"], today)
        if end is None or nxt <= end:
            next_due = nxt.isoformat()
    return SubscriptionOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        amount=from_cents(row["amount_cents"]) or 0.0,
        category=row["category"],
        kind=row["kind"],
        account_id=account_id,
        account_name=account_name,
        to_account_id=to_account_id,
        to_account_name=to_account_name,
        frequency=row["frequency"],
        start_date=row["start_date"],
        end_date=row["end_date"],
        color=row["color"] or "",
        notes=row["notes"] or "",
        active=bool(row["active"]),
        next_due_date=next_due,
        created_at=row["created_at"],
    )


@router.get("/api/subscriptions", response_model=list[SubscriptionOut])
def list_subscriptions(
    account: Optional[int] = Query(default=None, ge=1),
    uid: int = Depends(require_auth),
) -> list[SubscriptionOut]:
    """List the user's scheduled items, time-ordered by next due date (soonest
    first). Rows with no upcoming due date (inactive or elapsed) sink to the
    bottom; name is the stable tiebreak. ``?account=<id>`` keeps only items that
    touch that account, as their account or as a transfer's destination."""
    today = date.today()
    sql = "SELECT * FROM subscriptions WHERE user_id=?"
    params: list[int] = [uid]
    if account is not None:
        sql += _ACCOUNT_FILTER
        params += [account, account]
    with db() as conn:
        rows = conn.execute(sql + " ORDER BY created_at", params).fetchall()
        out = [_subscription_row_to_out(conn, r, today) for r in rows]
    out.sort(
        key=lambda s: (s.next_due_date is None, s.next_due_date or "", s.name.lower())
    )
    return out


@router.get(
    "/api/subscriptions/occurrences",
    response_model=list[SubscriptionOccurrenceOut],
)
def list_occurrences(
    from_: str = Query(alias="from"),
    to: str = Query(...),
    account: Optional[int] = Query(default=None, ge=1),
    uid: int = Depends(require_auth),
) -> list[SubscriptionOccurrenceOut]:
    """Expand every active scheduled item's due dates within ``[from, to]``
    (both inclusive, ISO ``YYYY-MM-DD``) for the calendar view — sorted by date.
    ``?account=<id>`` filters the same way as the list."""
    try:
        window_start = date.fromisoformat(from_)
        window_end = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(400, "from/to must be ISO dates (YYYY-MM-DD)") from None
    if window_end < window_start:
        raise HTTPException(400, "to must not be before from")
    if (window_end - window_start).days > _MAX_WINDOW_DAYS:
        raise HTTPException(400, f"window too large (max {_MAX_WINDOW_DAYS} days)")
    sql = "SELECT * FROM subscriptions WHERE user_id=? AND active=1"
    params: list[int] = [uid]
    if account is not None:
        sql += _ACCOUNT_FILTER
        params += [account, account]
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    out: list[SubscriptionOccurrenceOut] = []
    for r in rows:
        start = date.fromisoformat(r["start_date"])
        end = date.fromisoformat(r["end_date"]) if r["end_date"] else None
        amount = from_cents(r["amount_cents"]) or 0.0
        for d in occurrences_between(
            start, r["frequency"], end, window_start, window_end
        ):
            out.append(
                SubscriptionOccurrenceOut(
                    date=d.isoformat(),
                    subscription_id=r["id"],
                    name=r["name"],
                    amount=amount,
                    color=r["color"] or "",
                    kind=r["kind"],
                    account_id=r["account_id"],
                    to_account_id=r["to_account_id"],
                )
            )
    out.sort(key=lambda o: (o.date, o.name.lower()))
    return out


@router.post("/api/subscriptions", status_code=201, response_model=SubscriptionOut)
def create_subscription(
    data: SubscriptionIn, uid: int = Depends(require_auth)
) -> SubscriptionOut:
    """Create a scheduled item. Its accounts are checked against its ``kind``
    (see ``_check_links``): 404 for an account that isn't the user's, 400 for a
    transfer missing an end, pointing at itself or crossing currencies, or a
    payment/income naming a destination."""
    today = date.today()
    with db() as conn:
        _check_links(conn, uid, data.kind, data.account_id, data.to_account_id)
        cur = conn.execute(
            "INSERT INTO subscriptions(user_id, name, amount_cents, category,"
            " kind, account_id, to_account_id, frequency, start_date, end_date,"
            " color, notes, active)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                uid,
                data.name,
                to_cents(data.amount),
                data.category,
                data.kind,
                data.account_id,
                data.to_account_id,
                data.frequency,
                data.start_date,
                data.end_date,
                data.color,
                data.notes,
                int(data.active),
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM subscriptions WHERE id=?", (cur.lastrowid,)
        ).fetchone()
        return _subscription_row_to_out(conn, row, today)


@router.put("/api/subscriptions/{sid}", response_model=SubscriptionOut)
def update_subscription(
    sid: int,
    data: SubscriptionPatch,
    uid: int = Depends(require_auth),
) -> SubscriptionOut:
    """Patch the supplied fields of one of the user's scheduled items (404 if
    not theirs). Uses ``exclude_unset`` so an explicit null on a nullable field
    (``account_id``, ``to_account_id``, ``end_date``) clears it while an omitted
    field is left unchanged.

    A patch touching ``kind`` or either account is merged with the stored row
    and the result re-checked by ``_check_links``, since a partial patch carries
    only some of the trio. Switching ``kind`` away from transfer without naming
    ``to_account_id`` drops the stored destination, which no longer means
    anything; naming one alongside a non-transfer kind is rejected.
    """
    today = date.today()
    with db() as conn:
        existing = conn.execute(
            "SELECT kind, account_id, to_account_id FROM subscriptions"
            " WHERE id=? AND user_id=?",
            (sid, uid),
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Not found")
        patch = data.model_dump(exclude_unset=True)
        if patch.get("kind", "") is None:
            # `kind` is NOT NULL; an explicit null means "leave it as it is".
            del patch["kind"]
        if {"kind", "account_id", "to_account_id"} & patch.keys():
            kind = patch.get("kind", existing["kind"])
            if kind != "transfer" and "to_account_id" not in patch:
                patch["to_account_id"] = None
            _check_links(
                conn,
                uid,
                kind,
                patch.get("account_id", existing["account_id"]),
                patch.get("to_account_id", existing["to_account_id"]),
            )
        if "amount" in patch:
            patch["amount_cents"] = to_cents(patch.pop("amount"))
        if "active" in patch:
            patch["active"] = int(patch["active"])
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(
                f"UPDATE subscriptions SET {sets} WHERE id=?", [*patch.values(), sid]
            )
            conn.commit()
        row = conn.execute("SELECT * FROM subscriptions WHERE id=?", (sid,)).fetchone()
        return _subscription_row_to_out(conn, row, today)


@router.delete("/api/subscriptions/{sid}", response_model=OkOut)
def delete_subscription(sid: int, uid: int = Depends(require_auth)) -> OkOut:
    """Delete one of the user's scheduled items (404 if not theirs)."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM subscriptions WHERE id=? AND user_id=?", (sid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM subscriptions WHERE id=?", (sid,))
        conn.commit()
    return OkOut(ok=True)
