"""Transactions plus account-to-account transfers.

A transfer is recorded as two linked transactions sharing a ``transfer_id``;
both legs are created, edited (guarded) and deleted together. Balance side
effects go through ``services/accounts._adjust_account_balance`` so accounts
can't drift.
"""

from typing import Optional
import sqlite3
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from db import db, from_cents, to_cents, utcnow_iso
from auth import require_auth
from schemas import (
    OkOut,
    TransactionIn,
    TransactionOut,
    TransactionPatch,
    TransferIn,
)
from services.accounts import _adjust_account_balance

router = APIRouter(tags=["transactions"])


_TXN_SORT_MAP: dict[str, str] = {
    "date": "occurred_at DESC, id DESC",  # Newest
    "date_asc": "occurred_at ASC, id ASC",  # Oldest
    "amount": "ABS(amount_cents) DESC, id DESC",  # Largest
    "amount_asc": "ABS(amount_cents) ASC, id ASC",  # Smallest
}


def _txn_row_to_out(row: sqlite3.Row) -> TransactionOut:
    return TransactionOut(
        id=row["id"],
        user_id=row["user_id"],
        account_id=row["account_id"],
        amount=from_cents(row["amount_cents"]) or 0.0,
        occurred_at=row["occurred_at"],
        merchant=row["merchant"],
        category=row["category"],
        note=row["note"] or "",
        transfer_id=row["transfer_id"] if "transfer_id" in row.keys() else None,
        created_at=row["created_at"],
    )


@router.get("/api/transactions", response_model=list[TransactionOut])
def list_transactions(
    search: Optional[str] = Query(default=None, max_length=200),
    account: Optional[int] = Query(default=None, ge=1),
    category: Optional[str] = Query(default=None, max_length=100),
    sort: Optional[str] = Query(default="date"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    uid: int = Depends(require_auth),
) -> list[TransactionOut]:
    clauses = ["user_id=?"]
    params: list = [uid]
    if search:
        clauses.append("(merchant LIKE ? OR category LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if account is not None:
        clauses.append("account_id=?")
        params.append(account)
    if category is not None:
        clauses.append("category=?")
        params.append(category)
    order = _TXN_SORT_MAP.get(sort or "date", _TXN_SORT_MAP["date"])
    offset = (page - 1) * per_page
    sql = (
        f"SELECT * FROM transactions WHERE {' AND '.join(clauses)}"
        f" ORDER BY {order} LIMIT ? OFFSET ?"
    )
    params += [per_page, offset]
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_txn_row_to_out(r) for r in rows]


@router.post("/api/transactions", status_code=201, response_model=TransactionOut)
def create_transaction(
    data: TransactionIn,
    uid: int = Depends(require_auth),
) -> TransactionOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (data.account_id, uid)
        ).fetchone():
            raise HTTPException(404, "Account not found")
        ts = data.occurred_at or utcnow_iso()
        amount_cents = to_cents(data.amount)
        cur = conn.execute(
            "INSERT INTO transactions(user_id, account_id, amount_cents,"
            " occurred_at, merchant, category, note) VALUES(?,?,?,?,?,?,?)",
            (
                uid,
                data.account_id,
                amount_cents,
                ts,
                data.merchant,
                data.category,
                data.note,
            ),
        )
        _adjust_account_balance(conn, data.account_id, amount_cents)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM transactions WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _txn_row_to_out(row)


@router.post("/api/transfers", status_code=201, response_model=list[TransactionOut])
def create_transfer(
    data: TransferIn,
    uid: int = Depends(require_auth),
) -> list[TransactionOut]:
    """Move money between two of the user's accounts. Recorded as two linked
    transactions — `-amount` on the source and `+amount` on the destination —
    sharing a transfer_id, so net worth is unchanged and both legs delete
    together. Restricted to accounts sharing a currency."""
    if data.from_account_id == data.to_account_id:
        raise HTTPException(400, "Cannot transfer to the same account")
    with db() as conn:
        src = conn.execute(
            "SELECT id, name, currency FROM accounts WHERE id=? AND user_id=?",
            (data.from_account_id, uid),
        ).fetchone()
        dst = conn.execute(
            "SELECT id, name, currency FROM accounts WHERE id=? AND user_id=?",
            (data.to_account_id, uid),
        ).fetchone()
        if not src or not dst:
            raise HTTPException(404, "Account not found")
        if (src["currency"] or "GBP") != (dst["currency"] or "GBP"):
            raise HTTPException(
                400,
                "Transfers between accounts of different currencies are not supported",
            )
        ts = data.occurred_at or utcnow_iso()
        amount_cents = to_cents(data.amount)
        transfer_id = uuid.uuid4().hex
        ids: list[int] = []
        for account_id, signed, merchant in (
            (src["id"], -amount_cents, f"Transfer to {dst['name']}"),
            (dst["id"], amount_cents, f"Transfer from {src['name']}"),
        ):
            cur = conn.execute(
                "INSERT INTO transactions(user_id, account_id, amount_cents,"
                " occurred_at, merchant, category, note, transfer_id)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (
                    uid,
                    account_id,
                    signed,
                    ts,
                    merchant,
                    "Transfer",
                    data.note,
                    transfer_id,
                ),
            )
            ids.append(cur.lastrowid)
            _adjust_account_balance(conn, account_id, signed)
        conn.commit()
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"SELECT * FROM transactions WHERE id IN ({placeholders}) ORDER BY id",
            ids,
        ).fetchall()
    return [_txn_row_to_out(r) for r in rows]


@router.put("/api/transactions/{tid}", response_model=TransactionOut)
def update_transaction(
    tid: int,
    data: TransactionPatch,
    uid: int = Depends(require_auth),
) -> TransactionOut:
    with db() as conn:
        old = conn.execute(
            "SELECT * FROM transactions WHERE id=? AND user_id=?", (tid, uid)
        ).fetchone()
        if not old:
            raise HTTPException(404, "Not found")
        if old["transfer_id"]:
            raise HTTPException(
                400,
                "A transfer can't be edited — delete it and create a new one",
            )
        patch = data.model_dump(exclude_none=True)
        if "account_id" in patch:
            if not conn.execute(
                "SELECT 1 FROM accounts WHERE id=? AND user_id=?",
                (patch["account_id"], uid),
            ).fetchone():
                raise HTTPException(404, "Account not found")
        if "amount" in patch:
            patch["amount_cents"] = to_cents(patch.pop("amount"))
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(
                f"UPDATE transactions SET {sets} WHERE id=?", [*patch.values(), tid]
            )
            if "amount_cents" in patch or "account_id" in patch:
                _adjust_account_balance(conn, old["account_id"], -old["amount_cents"])
                _adjust_account_balance(
                    conn,
                    patch.get("account_id", old["account_id"]),
                    patch.get("amount_cents", old["amount_cents"]),
                )
            conn.commit()
        row = conn.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()
    return _txn_row_to_out(row)


@router.delete("/api/transactions/{tid}", response_model=OkOut)
def delete_transaction(tid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        txn = conn.execute(
            "SELECT id, account_id, amount_cents, transfer_id"
            " FROM transactions WHERE id=? AND user_id=?",
            (tid, uid),
        ).fetchone()
        if not txn:
            raise HTTPException(404, "Not found")
        # A transfer is two linked legs; deleting either removes both and
        # reverses both balance adjustments, so the accounts can't drift.
        if txn["transfer_id"]:
            legs = conn.execute(
                "SELECT id, account_id, amount_cents FROM transactions"
                " WHERE transfer_id=? AND user_id=?",
                (txn["transfer_id"], uid),
            ).fetchall()
        else:
            legs = [txn]
        for leg in legs:
            _adjust_account_balance(conn, leg["account_id"], -leg["amount_cents"])
            conn.execute("DELETE FROM transactions WHERE id=?", (leg["id"],))
        conn.commit()
    return OkOut(ok=True)
