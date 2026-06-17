"""Accounts CRUD plus per-account balance history.

Balance recording and history live here alongside the account routes they
hang off (`/api/accounts/{aid}/balance`, `/{aid}/history`). The shared
balance-adjustment helpers used by transactions/goals live in
``services/accounts.py``, not here — these routes don't need them.
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from constants import ISO_FMT, MAX_DAYS, SUBTYPES_BY_TYPE
from db import db, from_cents, to_cents, utcnow_iso
from auth import require_auth
from schemas import (
    AccountIn,
    AccountOut,
    AccountPatch,
    BalanceEntryOut,
    BalanceIn,
    OkOut,
)
from services.accounts import LATEST_BALANCE_JOIN

router = APIRouter(tags=["accounts"])


def _account_row_to_out(row: sqlite3.Row) -> AccountOut:
    """Map an ``accounts`` row to ``AccountOut``, filling sensible defaults for
    legacy NULLs and surfacing the joined latest balance when present."""
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
        currency=row["currency"] or "GBP",
        interest_rate=row["interest_rate"],
        color=row["color"],
        counts_to_net_worth=bool(row["counts_to_net_worth"]),
        created_at=row["created_at"],
        current_balance=from_cents(row["current_balance_cents"])
        if "current_balance_cents" in row.keys()
        else None,
        last_updated=row["last_updated"] if "last_updated" in row.keys() else None,
    )


@router.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(uid: int = Depends(require_auth)) -> list[AccountOut]:
    """List the user's accounts, each joined to its most recent balance-history
    entry (current balance + when it was last updated), oldest first."""
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
    return [_account_row_to_out(r) for r in rows]


@router.post("/api/accounts", status_code=201, response_model=AccountOut)
def create_account(data: AccountIn, uid: int = Depends(require_auth)) -> AccountOut:
    """Create an account for the user. It starts with no balance history, so the
    returned ``current_balance``/``last_updated`` are None until one is recorded."""
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO accounts(user_id, name, type, subtype, currency, interest_rate, color, counts_to_net_worth)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (
                uid,
                data.name,
                data.type,
                data.subtype,
                data.currency,
                data.interest_rate,
                data.color,
                int(data.counts_to_net_worth),
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
        currency=row["currency"] or "GBP",
        interest_rate=row["interest_rate"],
        color=row["color"],
        counts_to_net_worth=bool(row["counts_to_net_worth"]),
        created_at=row["created_at"],
        current_balance=None,
        last_updated=None,
    )


@router.put("/api/accounts/{aid}", response_model=AccountOut)
def update_account(
    aid: int,
    data: AccountPatch,
    uid: int = Depends(require_auth),
) -> AccountOut:
    """Patch the supplied fields of one of the user's accounts (404 if not
    theirs).

    Only non-None fields are applied. Subtype is re-checked against the row's
    existing ``type`` here because a partial patch omits ``type``, so the
    schema-level validator can't see it.
    """
    with db() as conn:
        existing = conn.execute(
            "SELECT type FROM accounts WHERE id=? AND user_id=?", (aid, uid)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Not found")
        updates = {k: v for k, v in data.model_dump().items() if v is not None}
        # Cross-field check: subtype must be valid for the row's existing type.
        # The Pydantic schema can't enforce this on a partial patch because
        # `type` isn't in the payload.
        if (
            "subtype" in updates
            and updates["subtype"] not in SUBTYPES_BY_TYPE[existing["type"]]
        ):
            raise HTTPException(
                400,
                f"subtype '{updates['subtype']}' is not valid for type '{existing['type']}'",
            )
        if updates:
            sets = ", ".join(f"{k}=?" for k in updates)
            conn.execute(
                f"UPDATE accounts SET {sets} WHERE id=?", [*updates.values(), aid]
            )
            conn.commit()
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (aid,)).fetchone()
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
        currency=row["currency"] or "GBP",
        interest_rate=row["interest_rate"],
        color=row["color"],
        counts_to_net_worth=bool(row["counts_to_net_worth"]),
        created_at=row["created_at"],
    )


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
    theirs), timestamped now unless the body supplies ``recorded_at``."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        ts = data.recorded_at or utcnow_iso()
        conn.execute(
            "INSERT INTO balance_history(account_id, balance_cents, notes, recorded_at)"
            " VALUES(?,?,?,?)",
            (aid, to_cents(data.balance), data.notes, ts),
        )
        conn.commit()
    return OkOut(ok=True)


@router.get("/api/accounts/{aid}/history", response_model=list[BalanceEntryOut])
def get_history(
    aid: int,
    days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 90,
    uid: int = Depends(require_auth),
) -> list[BalanceEntryOut]:
    """Return the balance-history points for one of the user's accounts (404 if
    not theirs) over the last ``days`` (default 90), oldest first."""
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
    return [
        BalanceEntryOut(
            balance=from_cents(r["balance_cents"]) or 0.0,
            notes=r["notes"],
            recorded_at=r["recorded_at"],
        )
        for r in rows
    ]
