"""Recurring budget items plus a forward balance/net-worth projection.

The projection compounds each account's balance with its interest rate and the
net monthly flow of its budget items, then rolls up a base-currency net-worth
line via ``services/currency``.
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from constants import FREQ_TO_MONTHLY
from db import db, from_cents, to_cents
from auth import require_auth
from schemas import BudgetItemIn, BudgetItemOut, BudgetItemPatch, OkOut
from services.currency import _convert_to_base, _load_rates

router = APIRouter(tags=["budget"])


def _budget_row_to_out(row: sqlite3.Row) -> BudgetItemOut:
    return BudgetItemOut(
        id=row["id"],
        user_id=row["user_id"],
        account_id=row["account_id"],
        name=row["name"],
        amount=from_cents(row["amount_cents"]) or 0.0,
        frequency=row["frequency"],
        created_at=row["created_at"],
    )


@router.get("/api/budget", response_model=list[BudgetItemOut])
def list_budget_items(uid: int = Depends(require_auth)) -> list[BudgetItemOut]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM budget_items WHERE user_id=? ORDER BY account_id, created_at",
            (uid,),
        ).fetchall()
    return [_budget_row_to_out(r) for r in rows]


@router.post("/api/budget", status_code=201, response_model=BudgetItemOut)
def create_budget_item(
    data: BudgetItemIn,
    uid: int = Depends(require_auth),
) -> BudgetItemOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (data.account_id, uid)
        ).fetchone():
            raise HTTPException(404, "Account not found")
        cur = conn.execute(
            "INSERT INTO budget_items(user_id, account_id, name, amount_cents, frequency)"
            " VALUES(?,?,?,?,?)",
            (uid, data.account_id, data.name, to_cents(data.amount), data.frequency),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM budget_items WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _budget_row_to_out(row)


@router.put("/api/budget/{bid}", response_model=BudgetItemOut)
def update_budget_item(
    bid: int,
    data: BudgetItemPatch,
    uid: int = Depends(require_auth),
) -> BudgetItemOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_items WHERE id=? AND user_id=?", (bid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        # Translate the user-facing payload (dollars) into the DB columns (cents).
        patch = data.model_dump(exclude_none=True)
        if "amount" in patch:
            patch["amount_cents"] = to_cents(patch.pop("amount"))
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(
                f"UPDATE budget_items SET {sets} WHERE id=?", [*patch.values(), bid]
            )
            conn.commit()
        row = conn.execute("SELECT * FROM budget_items WHERE id=?", (bid,)).fetchone()
    return _budget_row_to_out(row)


@router.delete("/api/budget/{bid}", response_model=OkOut)
def delete_budget_item(bid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_items WHERE id=? AND user_id=?", (bid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM budget_items WHERE id=?", (bid,))
        conn.commit()
    return OkOut(ok=True)


@router.get("/api/budget/projection")
def budget_projection(
    months: Annotated[int, Query(ge=1, le=12)] = 6,
    uid: int = Depends(require_auth),
) -> dict:
    if months not in (3, 6, 12):
        raise HTTPException(400, "months must be 3, 6, or 12")
    with db() as conn:
        user = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        accounts = conn.execute(
            """
            SELECT a.id, a.name, a.type, a.interest_rate, a.color, a.currency,
                   b.balance_cents AS current_balance_cents
            FROM accounts a
            LEFT JOIN balance_history b ON b.id = (
                SELECT id FROM balance_history WHERE account_id=a.id
                ORDER BY recorded_at DESC, id DESC LIMIT 1
            )
            WHERE a.user_id = ?
            ORDER BY a.created_at
        """,
            (uid,),
        ).fetchall()

        items = conn.execute(
            "SELECT account_id, amount_cents, frequency FROM budget_items WHERE user_id=?",
            (uid,),
        ).fetchall()
        rates = _load_rates(conn, uid)
    base = (user["base_currency"] if user else None) or "GBP"

    # Sum all budget items into a monthly net flow per account (in dollars).
    monthly_net: dict[int, float] = {}
    for item in items:
        flow = from_cents(item["amount_cents"]) * FREQ_TO_MONTHLY[item["frequency"]]
        monthly_net[item["account_id"]] = (
            monthly_net.get(item["account_id"], 0.0) + flow
        )

    now = datetime.now(timezone.utc)
    result: list[dict] = []
    for acc in accounts:
        bal = from_cents(acc["current_balance_cents"]) or 0.0
        monthly_rate = (acc["interest_rate"] / 100) / 12
        net = monthly_net.get(acc["id"], 0.0)

        # Month 0 = today
        points: list[dict] = [
            {"month": 0, "balance": round(bal, 2), "date": now.strftime("%Y-%m-%d")}
        ]
        for m in range(1, months + 1):
            # Cash flow at start of period, then interest compounds on the full balance.
            bal = (bal + net) * (1 + monthly_rate)
            bal = round(bal, 2)
            date = (now + timedelta(days=m * 30.44)).strftime("%Y-%m-%d")
            points.append({"month": m, "balance": bal, "date": date})

        result.append(
            {
                "id": acc["id"],
                "name": acc["name"],
                "type": acc["type"],
                "color": acc["color"],
                "currency": acc["currency"] or "GBP",
                "current_balance": from_cents(acc["current_balance_cents"]),
                "monthly_net": round(net, 2),
                "points": points,
                "final_balance": points[-1]["balance"],
            }
        )

    # Net worth at each month: assets minus liabilities, converted into the
    # user's base currency so the line is meaningful across mixed-currency
    # portfolios. Per-account points stay in their native currency above.
    net_worth: list[dict] = []
    for m in range(months + 1):
        nw = 0.0
        for acc in result:
            native = acc["points"][m]["balance"]
            v = _convert_to_base(native, acc["currency"], base, rates)
            nw += -v if acc["type"] in ("loan", "credit") else v
        date = result[0]["points"][m]["date"] if result else now.strftime("%Y-%m-%d")
        net_worth.append({"month": m, "balance": round(nw, 2), "date": date})

    return {
        "months": months,
        "accounts": result,
        "net_worth": net_worth,
        "base_currency": base,
    }
