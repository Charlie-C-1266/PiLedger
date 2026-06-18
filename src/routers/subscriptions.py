"""Recurring subscriptions / standing orders — reminder-only in v1.

A subscription never posts a transaction; it records a recurring payment so the
app can surface upcoming renewal dates as a time-ordered list and a month
calendar. ``next_due_date`` is computed on read (never stored) so an elapsed row
can't go stale, and the calendar window is expanded server-side via
``services/subscriptions`` so the frontend does no recurrence math. Account
ownership, where a subscription is linked to one, is validated via
``services/accounts.require_account`` exactly as goals do.
"""

from datetime import date
import sqlite3

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


def _subscription_row_to_out(
    conn: sqlite3.Connection, row: sqlite3.Row, today: date
) -> SubscriptionOut:
    """Build a SubscriptionOut, resolving the linked account name and computing
    ``next_due_date`` (the next occurrence on/after ``today``). A link to a
    since-deleted account reports as unlinked; an inactive or elapsed-past-
    ``end_date`` subscription reports no next due date."""
    account_id = row["account_id"]
    account_name = None
    if account_id is not None:
        acc = conn.execute(
            "SELECT name FROM accounts WHERE id=? AND user_id=?",
            (account_id, row["user_id"]),
        ).fetchone()
        if acc is None:
            account_id = None
        else:
            account_name = acc["name"]
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
        account_id=account_id,
        account_name=account_name,
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
def list_subscriptions(uid: int = Depends(require_auth)) -> list[SubscriptionOut]:
    """List the user's subscriptions, time-ordered by next due date (soonest
    first). Rows with no upcoming due date (inactive or elapsed) sink to the
    bottom; name is the stable tiebreak."""
    today = date.today()
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM subscriptions WHERE user_id=? ORDER BY created_at", (uid,)
        ).fetchall()
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
    uid: int = Depends(require_auth),
) -> list[SubscriptionOccurrenceOut]:
    """Expand every active subscription's due dates within ``[from, to]`` (both
    inclusive, ISO ``YYYY-MM-DD``) for the calendar view — sorted by date."""
    try:
        window_start = date.fromisoformat(from_)
        window_end = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(400, "from/to must be ISO dates (YYYY-MM-DD)") from None
    if window_end < window_start:
        raise HTTPException(400, "to must not be before from")
    if (window_end - window_start).days > _MAX_WINDOW_DAYS:
        raise HTTPException(400, f"window too large (max {_MAX_WINDOW_DAYS} days)")
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM subscriptions WHERE user_id=? AND active=1", (uid,)
        ).fetchall()
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
                )
            )
    out.sort(key=lambda o: (o.date, o.name.lower()))
    return out


@router.post("/api/subscriptions", status_code=201, response_model=SubscriptionOut)
def create_subscription(
    data: SubscriptionIn, uid: int = Depends(require_auth)
) -> SubscriptionOut:
    """Create a subscription. A given ``account_id`` must be one of the user's
    accounts (else 404)."""
    today = date.today()
    with db() as conn:
        if data.account_id is not None:
            require_account(conn, data.account_id, uid)
        cur = conn.execute(
            "INSERT INTO subscriptions(user_id, name, amount_cents, category,"
            " account_id, frequency, start_date, end_date, color, notes, active)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                uid,
                data.name,
                to_cents(data.amount),
                data.category,
                data.account_id,
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
    """Patch the supplied fields of one of the user's subscriptions (404 if not
    theirs). Uses ``exclude_unset`` so an explicit ``account_id``/``end_date`` of
    null clears that field while an omitted field is left unchanged; a new
    non-null account link is validated for ownership."""
    today = date.today()
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM subscriptions WHERE id=? AND user_id=?", (sid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        patch = data.model_dump(exclude_unset=True)
        if patch.get("account_id") is not None:
            require_account(conn, patch["account_id"], uid)
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
    """Delete one of the user's subscriptions (404 if not theirs)."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM subscriptions WHERE id=? AND user_id=?", (sid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM subscriptions WHERE id=?", (sid,))
        conn.commit()
    return OkOut(ok=True)
