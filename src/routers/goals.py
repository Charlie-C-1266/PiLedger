"""Savings goals, optionally linked to an account for live progress tracking.

A goal linked to an account derives its ``saved`` amount from that account's
latest balance; an unlinked goal stores its own value. Account ownership is
validated via ``services/accounts._require_account``.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from db import db, from_cents, to_cents
from auth import require_auth
from schemas import GoalIn, GoalOut, GoalPatch, OkOut
from services.accounts import _require_account

router = APIRouter(tags=["goals"])


def _goal_row_to_out(conn: sqlite3.Connection, row: sqlite3.Row) -> GoalOut:
    """Build a GoalOut. For a goal linked to an account, `saved` mirrors that
    account's latest balance (live tracking) and `account_name` is populated;
    otherwise `saved` is the goal's own stored value. A link to a since-deleted
    account is reported as unlinked."""
    account_id = row["account_id"] if "account_id" in row.keys() else None
    saved = from_cents(row["saved_cents"]) or 0.0
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
            bal = conn.execute(
                "SELECT balance_cents FROM balance_history WHERE account_id=?"
                " ORDER BY recorded_at DESC, id DESC LIMIT 1",
                (account_id,),
            ).fetchone()
            saved = (from_cents(bal["balance_cents"]) or 0.0) if bal else 0.0
    return GoalOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        target=from_cents(row["target_cents"]) or 0.0,
        saved=saved,
        monthly=from_cents(row["monthly_cents"]) or 0.0,
        color=row["color"],
        account_id=account_id,
        account_name=account_name,
        created_at=row["created_at"],
    )


@router.get("/api/goals", response_model=list[GoalOut])
def list_goals(uid: int = Depends(require_auth)) -> list[GoalOut]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM goals WHERE user_id=? ORDER BY created_at", (uid,)
        ).fetchall()
        return [_goal_row_to_out(conn, r) for r in rows]


@router.post("/api/goals", status_code=201, response_model=GoalOut)
def create_goal(data: GoalIn, uid: int = Depends(require_auth)) -> GoalOut:
    with db() as conn:
        if data.account_id is not None:
            _require_account(conn, data.account_id, uid)
        cur = conn.execute(
            "INSERT INTO goals(user_id, name, target_cents, saved_cents,"
            " monthly_cents, color, account_id) VALUES(?,?,?,?,?,?,?)",
            (
                uid,
                data.name,
                to_cents(data.target),
                to_cents(data.saved),
                to_cents(data.monthly),
                data.color,
                data.account_id,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM goals WHERE id=?", (cur.lastrowid,)
        ).fetchone()
        return _goal_row_to_out(conn, row)


@router.put("/api/goals/{gid}", response_model=GoalOut)
def update_goal(
    gid: int,
    data: GoalPatch,
    uid: int = Depends(require_auth),
) -> GoalOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM goals WHERE id=? AND user_id=?", (gid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        # exclude_unset (not exclude_none) so an explicit account_id=null
        # unlinks the goal, while an omitted field is left unchanged.
        patch = data.model_dump(exclude_unset=True)
        if patch.get("account_id") is not None:
            _require_account(conn, patch["account_id"], uid)
        if "target" in patch:
            patch["target_cents"] = to_cents(patch.pop("target"))
        if "saved" in patch:
            patch["saved_cents"] = to_cents(patch.pop("saved"))
        if "monthly" in patch:
            patch["monthly_cents"] = to_cents(patch.pop("monthly"))
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(f"UPDATE goals SET {sets} WHERE id=?", [*patch.values(), gid])
            conn.commit()
        row = conn.execute("SELECT * FROM goals WHERE id=?", (gid,)).fetchone()
        return _goal_row_to_out(conn, row)


@router.delete("/api/goals/{gid}", response_model=OkOut)
def delete_goal(gid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM goals WHERE id=? AND user_id=?", (gid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM goals WHERE id=?", (gid,))
        conn.commit()
    return OkOut(ok=True)
