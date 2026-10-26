"""Scheduled items (stored as ``subscriptions``) and their postings.

A scheduled item records a recurring payment, income or transfer so the app can
surface upcoming due dates as a time-ordered list and a month calendar. It is a
reminder unless ``auto_post`` is on, in which case ``services/posting`` turns
each due date into a real transaction (at startup, daily, or on
``POST /api/subscriptions/post-due``). Any item's single occurrence can also be
posted early, skipped, or un-handled again (Post now / Skip / Undo). The table
and the ``/api/subscriptions`` paths keep their original name because
API-token and MCP clients depend on them; only the screen is called
"Scheduled". ``next_due_date`` is computed on read (never stored) so an elapsed
row can't go stale, and the calendar window is expanded server-side via
``services/subscriptions`` so the frontend does no recurrence math.

``kind`` decides what the account links mean (see ``_check_links``): an expense
or income may name one account, and a transfer must name two different accounts
of the user's that share a currency. ``amount`` is always positive.

Auto-post is off unless a request asks for it, so existing API clients never
start moving money. It needs an open account to post to (both, for a
transfer). ``auto_post_from`` — the first day it may post — is today whenever
auto-post is switched on, the item is resumed, or when or where it posts
changes, unless the request names it; that is what stops a switch-on or an edit
from back-filling the past.
"""

from datetime import date, datetime, timedelta
import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from db import db, from_cents, to_cents
from auth import require_auth
from schemas import (
    OkOut,
    PostDueOut,
    SubscriptionIn,
    SubscriptionOccurrenceIn,
    SubscriptionOccurrenceOut,
    SubscriptionOut,
    SubscriptionPatch,
    SubscriptionPostingOut,
)
from services.accounts import require_account, require_open_account
from services.posting import (
    PostingError,
    handled_dates,
    is_occurrence,
    item_schedule,
    post_due,
    post_now,
    posting_statuses,
    skip_occurrence,
    undo_posting,
)
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


def _check_auto_post(
    conn: sqlite3.Connection,
    uid: int,
    kind: str,
    account_id: Optional[int],
    to_account_id: Optional[int],
) -> None:
    """Enforce that an auto-posting item has somewhere to post: its account
    (and, for a transfer, its destination) must be linked and open — 400
    otherwise. Ownership and currency are ``_check_links``'s job."""
    ids = [account_id, to_account_id] if kind == "transfer" else [account_id]
    if any(i is None for i in ids):
        raise HTTPException(400, "Auto-post needs an account to post to")
    for account in ids:
        assert account is not None
        require_open_account(conn, account, uid)


# A patch changing any of these moves an auto-posting item's `auto_post_from`
# to today: they decide when or where it posts, so dates that weren't due
# before the edit mustn't be back-filled after it.
_RESTART_FIELDS = (
    "kind",
    "account_id",
    "to_account_id",
    "frequency",
    "start_date",
    "end_date",
)


def _restarts_auto_post(existing: sqlite3.Row, patch: dict[str, Any]) -> bool:
    """Whether a patch to an auto-posting item should restart it from today:
    auto-post is being switched on, the item is being resumed, or its schedule
    or accounts actually change (the app resends unchanged fields)."""
    if not existing["auto_post"]:
        return True
    if patch.get("active") and not existing["active"]:
        return True
    return any(k in patch and patch[k] != existing[k] for k in _RESTART_FIELDS)


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


def _next_due(row: sqlite3.Row, today: date, handled: set[date]) -> Optional[date]:
    """The item's next occurrence on or after ``today`` that isn't already
    posted or skipped, or None when it's paused or has run past its end."""
    if not row["active"]:
        return None
    start, frequency, end = item_schedule(row)
    nxt = next_occurrence(start, frequency, today)
    while nxt in handled and (end is None or nxt <= end):
        nxt = next_occurrence(start, frequency, nxt + timedelta(days=1))
    return nxt if end is None or nxt <= end else None


def _subscription_row_to_out(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    today: date,
    handled: Optional[set[date]] = None,
) -> SubscriptionOut:
    """Build a SubscriptionOut, resolving both linked account names and
    computing ``next_due_date`` (see ``_next_due``). ``handled`` is the item's
    posted/skipped dates from ``today`` on, looked up when not supplied. A link
    to a since-deleted account reports as unlinked; an inactive or elapsed-past-
    ``end_date`` subscription reports no next due date."""
    if handled is None:
        handled = handled_dates(conn, row["user_id"], [row["id"]], start=today)[
            row["id"]
        ]
    account_name = _account_name(conn, row["account_id"], row["user_id"])
    account_id = row["account_id"] if account_name is not None else None
    to_account_name = _account_name(conn, row["to_account_id"], row["user_id"])
    to_account_id = row["to_account_id"] if to_account_name is not None else None
    next_due = _next_due(row, today, handled)
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
        next_due_date=next_due.isoformat() if next_due else None,
        auto_post=bool(row["auto_post"]),
        auto_post_from=row["auto_post_from"],
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
        handled = handled_dates(conn, uid, [r["id"] for r in rows], start=today)
        out = [_subscription_row_to_out(conn, r, today, handled[r["id"]]) for r in rows]
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
    Each carries its posting-log ``status`` (``posted``/``skipped``, or null
    when unhandled). ``?account=<id>`` filters the same way as the list."""
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
        statuses = posting_statuses(
            conn, uid, [r["id"] for r in rows], window_start, window_end
        )
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
                    status=statuses[r["id"]].get(d),
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
    payment/income naming a destination.

    Auto-post stays off unless ``auto_post`` is true; then the account(s) must
    be open (400) and ``auto_post_from`` defaults to today — even for a past
    ``start_date``, so a new item never back-fills."""
    today = date.today()
    with db() as conn:
        _check_links(conn, uid, data.kind, data.account_id, data.to_account_id)
        auto_post_from = None
        if data.auto_post:
            _check_auto_post(conn, uid, data.kind, data.account_id, data.to_account_id)
            auto_post_from = data.auto_post_from or today.isoformat()
        cur = conn.execute(
            "INSERT INTO subscriptions(user_id, name, amount_cents, category,"
            " kind, account_id, to_account_id, frequency, start_date, end_date,"
            " color, notes, active, auto_post, auto_post_from)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
                int(data.auto_post),
                auto_post_from,
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

    When the result auto-posts, a patch touching auto-post, ``kind`` or either
    account re-checks that the accounts are linked and open (400). Switching
    auto-post on, resuming the item, or changing its schedule or accounts moves
    ``auto_post_from`` to today unless the patch names it (see
    ``_restarts_auto_post``); switching auto-post off clears it.
    """
    today = date.today()
    with db() as conn:
        existing = conn.execute(
            "SELECT * FROM subscriptions WHERE id=? AND user_id=?",
            (sid, uid),
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Not found")
        patch = data.model_dump(exclude_unset=True)
        for field in ("kind", "auto_post", "auto_post_from"):
            if field in patch and patch[field] is None:
                # An explicit null means "leave it as it is" (kind and
                # auto_post are NOT NULL; auto_post_from follows auto_post).
                del patch[field]
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
        if patch.get("auto_post", existing["auto_post"]):
            if {"auto_post", "kind", "account_id", "to_account_id"} & patch.keys():
                _check_auto_post(
                    conn,
                    uid,
                    patch.get("kind", existing["kind"]),
                    patch.get("account_id", existing["account_id"]),
                    patch.get("to_account_id", existing["to_account_id"]),
                )
            if "auto_post_from" not in patch and _restarts_auto_post(existing, patch):
                patch["auto_post_from"] = today.isoformat()
        elif existing["auto_post_from"] is not None or "auto_post_from" in patch:
            patch["auto_post_from"] = None
        if "auto_post" in patch:
            patch["auto_post"] = int(patch["auto_post"])
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
    """Delete one of the user's scheduled items (404 if not theirs). Its
    posting log goes with it; transactions it posted are kept."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM subscriptions WHERE id=? AND user_id=?", (sid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM subscriptions WHERE id=?", (sid,))
        conn.commit()
    return OkOut(ok=True)


# ─── Posting ──────────────────────────────────────────────────────────────────


def _require_subscription(conn: sqlite3.Connection, sid: int, uid: int) -> sqlite3.Row:
    """One of the user's scheduled items, or 404."""
    row: Optional[sqlite3.Row] = conn.execute(
        "SELECT * FROM subscriptions WHERE id=? AND user_id=?", (sid, uid)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Not found")
    return row


def _parse_day(raw: str) -> date:
    """A ``YYYY-MM-DD`` string as a date (400 otherwise)."""
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "date must be an ISO date (YYYY-MM-DD)") from None


def _require_occurrence(sub: sqlite3.Row, raw: str) -> date:
    """``raw`` as a date that is one of ``sub``'s real occurrences (400 if it
    isn't on its schedule)."""
    day = _parse_day(raw)
    if not is_occurrence(*item_schedule(sub), day):
        raise HTTPException(400, "That date isn't one of this item's due dates")
    return day


def _posting_to_out(row: sqlite3.Row) -> SubscriptionPostingOut:
    """Map a ``subscription_postings`` row to its API shape."""
    return SubscriptionPostingOut(
        subscription_id=row["subscription_id"],
        date=row["occurrence_date"],
        status=row["status"],
        transaction_id=row["transaction_id"],
        transfer_id=row["transfer_id"],
    )


@router.post("/api/subscriptions/post-due", response_model=PostDueOut)
def post_due_subscriptions(uid: int = Depends(require_auth)) -> PostDueOut:
    """Run auto-post now for the calling user: post every occurrence their
    auto-posting items owe up to today, exactly as the daily run would. Safe to
    repeat — handled dates are never posted twice."""
    with db() as conn:
        return PostDueOut(posted=post_due(conn, date.today(), uid))


@router.post("/api/subscriptions/{sid}/post", response_model=SubscriptionPostingOut)
def post_subscription_occurrence(
    sid: int,
    data: SubscriptionOccurrenceIn,
    uid: int = Depends(require_auth),
) -> SubscriptionPostingOut:
    """Post now: create the transaction for one occurrence of any item (a
    reminder too), dated today, and record that occurrence as posted so
    auto-post won't post it again. ``date`` must be one of the item's due dates
    (400). Repeating it is a no-op; a skipped date becomes posted. 400 when the
    item has no open account to post to."""
    today = date.today()
    with db() as conn:
        sub = _require_subscription(conn, sid, uid)
        day = _require_occurrence(sub, data.date)
        try:
            row = post_now(conn, sub, day, today)
        except PostingError as e:
            raise HTTPException(400, str(e)) from None
        return _posting_to_out(row)


@router.post("/api/subscriptions/{sid}/skip", response_model=SubscriptionPostingOut)
def skip_subscription_occurrence(
    sid: int,
    data: SubscriptionOccurrenceIn,
    uid: int = Depends(require_auth),
) -> SubscriptionPostingOut:
    """Skip one occurrence: record it as skipped so it neither posts nor
    counts as upcoming. If it was already posted, that transaction is deleted
    and its balance effect reversed. ``date`` must be one of the item's due
    dates (400). Repeating it is a no-op."""
    with db() as conn:
        sub = _require_subscription(conn, sid, uid)
        day = _require_occurrence(sub, data.date)
        return _posting_to_out(skip_occurrence(conn, uid, sub["id"], day))


@router.delete("/api/subscriptions/{sid}/postings/{date}", response_model=OkOut)
def undo_subscription_posting(
    sid: int,
    occurrence_date: str = Path(alias="date"),
    uid: int = Depends(require_auth),
) -> OkOut:
    """Undo a Post now, Skip or auto-post: delete that occurrence's log row and
    any transaction (or transfer) it created, reversing the balance. The date
    is unhandled again — an auto-posting item posts it on its next run if it
    has passed. 404 when nothing is logged for that date. The date isn't
    checked against the schedule, so a posting made before an edit can still
    be undone."""
    day = _parse_day(occurrence_date)
    with db() as conn:
        sub = _require_subscription(conn, sid, uid)
        if not undo_posting(conn, uid, sub["id"], day):
            raise HTTPException(404, "Nothing to undo for that date")
    return OkOut(ok=True)
