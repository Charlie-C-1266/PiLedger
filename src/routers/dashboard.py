"""Aggregate dashboard reads: net-worth summary, balance history, projections.

These are read-only rollups over accounts + balance history. Cross-currency
totals are converted into the user's base currency via ``services/currency``.
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated
import math

from fastapi import APIRouter, Depends, Query

from constants import ISO_FMT, MAX_DAYS, MAX_MONTHS, RANGE_TO_DAYS, RangeKey
from db import db, from_cents
from auth import require_auth
from schemas import (
    HistoryAccountOut,
    HistoryPointOut,
    NetWorthPointOut,
    SummaryOut,
)
from services.accounts import _LATEST_BALANCE_JOIN
from services.currency import _convert_to_base, _load_rates

router = APIRouter(tags=["dashboard"])


@router.get("/api/summary", response_model=SummaryOut)
def get_summary(uid: int = Depends(require_auth)) -> SummaryOut:
    """Roll up the user's accounts into a net-worth summary in their base
    currency.

    The headline figures (``total``, ``assets``, ``debts``, ``savings_rate`` and
    the per-type sub-totals) describe **Accessible net worth** — only Accounts
    flagged ``counts_to_net_worth`` (ADR-0003). ``set_aside`` is the net
    contribution of the excluded Accounts and ``total_net_worth`` is the full
    picture (``total + set_aside``).

    Each account's latest balance is converted to base; loan/credit balances
    are subtracted as magnitudes (``abs``). Currencies with no rate fall back to
    1:1 and are reported in ``missing_rates`` so the UI can warn.
    """
    with db() as conn:
        user = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        rows = conn.execute(
            f"""
            SELECT a.type, a.currency, a.counts_to_net_worth, b.balance_cents
            FROM accounts a
            {_LATEST_BALANCE_JOIN}
            WHERE a.user_id = ?
        """,
            (uid,),
        ).fetchall()
        rates = _load_rates(conn, uid)
    base = (user["base_currency"] if user else None) or "GBP"
    current_t = savings_t = loans_t = credit_t = invest_t = 0.0
    set_aside = 0.0
    missing: set[str] = set()
    for r in rows:
        cur = r["currency"] or "GBP"
        amt = (r["balance_cents"] or 0) / 100
        if cur != base and cur not in rates:
            missing.add(cur)
        converted = _convert_to_base(amt, cur, base, rates)
        is_debt = r["type"] in ("loan", "credit")
        if not r["counts_to_net_worth"]:
            # Set-aside Account: contributes to the excluded total only, as a
            # signed net-worth figure (a debt lowers it just like in the headline).
            set_aside += -abs(converted) if is_debt else converted
            continue
        if r["type"] == "current":
            current_t += converted
        elif r["type"] == "savings":
            savings_t += converted
        elif r["type"] == "loan":
            loans_t += abs(converted)
        elif r["type"] == "credit":
            credit_t += abs(converted)
        elif r["type"] == "invest":
            invest_t += converted
    assets = round(current_t + savings_t + invest_t, 2)
    debts = round(loans_t + credit_t, 2)
    savings_rate = round(savings_t / assets * 100, 2) if assets > 0 else 0.0
    total = round(assets - debts, 2)
    set_aside = round(set_aside, 2)
    return SummaryOut(
        total=total,
        total_current=round(current_t, 2),
        total_savings=round(savings_t, 2),
        total_loans=round(loans_t, 2),
        total_credit=round(credit_t, 2),
        total_invest=round(invest_t, 2),
        assets=assets,
        debts=debts,
        savings_rate=savings_rate,
        set_aside=set_aside,
        total_net_worth=round(total + set_aside, 2),
        account_count=len(rows),
        base_currency=base,
        missing_rates=sorted(missing),
    )


@router.get("/api/history/all", response_model=list[HistoryAccountOut])
def all_history(
    days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 90,
    uid: int = Depends(require_auth),
) -> list[HistoryAccountOut]:
    """Return each account's balance-history series over the last ``days``
    (default 90). Accounts with no points in the window are omitted."""
    with db() as conn:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(ISO_FMT)
        accounts = conn.execute(
            "SELECT id, name, color, type, currency FROM accounts WHERE user_id=?",
            (uid,),
        ).fetchall()
        result: list[HistoryAccountOut] = []
        for a in accounts:
            hist = conn.execute(
                "SELECT balance_cents, recorded_at FROM balance_history"
                " WHERE account_id=? AND recorded_at>=? ORDER BY recorded_at",
                (a["id"], since),
            ).fetchall()
            if hist:
                result.append(
                    HistoryAccountOut(
                        id=a["id"],
                        name=a["name"],
                        color=a["color"],
                        type=a["type"],
                        currency=a["currency"] or "GBP",
                        history=[
                            HistoryPointOut(
                                balance=from_cents(h["balance_cents"]) or 0.0,
                                date=h["recorded_at"],
                            )
                            for h in hist
                        ],
                    )
                )
    return result


@router.get("/api/history/networth", response_model=list[NetWorthPointOut])
def networth_history(
    range_key: RangeKey = Query(default="30D", alias="range"),
    uid: int = Depends(require_auth),
) -> list[NetWorthPointOut]:
    """Return the net-worth time series (in base currency) over the selected
    range.

    Each account's balance is carried forward from its last point before the
    window, so the line starts at the true net worth rather than zero, and a new
    point is emitted on every date any account's balance changed. Loan/credit
    balances are subtracted as magnitudes to match ``/api/summary``.

    Only Accounts flagged ``counts_to_net_worth`` are included, so the trend is
    the Accessible net-worth line (ADR-0003). The flag is applied as it stands
    now across the whole timeline — it is not versioned, so flipping an Account
    redraws the entire history.
    """
    days = RANGE_TO_DAYS[range_key]
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(ISO_FMT)
    with db() as conn:
        user = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        base = (user["base_currency"] if user else None) or "GBP"
        rates = _load_rates(conn, uid)
        accounts = {
            r["id"]: r
            for r in conn.execute(
                "SELECT id, type, currency FROM accounts"
                " WHERE user_id=? AND counts_to_net_worth=1",
                (uid,),
            ).fetchall()
        }
        if not accounts:
            return []
        acct_ids = tuple(accounts)
        placeholders = ",".join("?" * len(acct_ids))
        # Carry-forward: latest balance per account before the window
        seeds = conn.execute(
            f"SELECT account_id, balance_cents FROM balance_history"
            f" WHERE id IN ("
            f"  SELECT MAX(bh2.id) FROM balance_history bh2"
            f"  WHERE bh2.account_id IN ({placeholders}) AND bh2.recorded_at < ?"
            f"  GROUP BY bh2.account_id"
            f" )",
            (*acct_ids, since),
        ).fetchall()
        latest: dict[int, int] = {r["account_id"]: r["balance_cents"] for r in seeds}
        entries = conn.execute(
            f"SELECT account_id, balance_cents, recorded_at"
            f" FROM balance_history"
            f" WHERE account_id IN ({placeholders}) AND recorded_at >= ?"
            f" ORDER BY recorded_at, id",
            (*acct_ids, since),
        ).fetchall()
    if not entries and not latest:
        return []
    by_date: dict[str, list] = {}
    for e in entries:
        d = e["recorded_at"][:10]
        by_date.setdefault(d, []).append(e)
    points: list[NetWorthPointOut] = []
    for d in sorted(by_date):
        for e in by_date[d]:
            latest[e["account_id"]] = e["balance_cents"]
        nw = 0.0
        for aid, cents in latest.items():
            acc = accounts.get(aid)
            if acc is None:
                continue
            amt = cents / 100
            cur = acc["currency"] or "GBP"
            converted = _convert_to_base(amt, cur, base, rates)
            if acc["type"] in ("loan", "credit"):
                # Mirror /api/summary: a debt is a positive magnitude subtracted
                # from net worth, whether its balance was recorded as a positive
                # number (e.g. 2000 owed) or a negative one (-2000). Without abs()
                # a negative-recorded debt flips sign and is *added*, making the
                # chart diverge above the headline net-worth figure.
                nw -= abs(converted)
            else:
                nw += converted
        points.append(NetWorthPointOut(date=d, value=round(nw, 2)))
    return points


@router.get("/api/projections")
def get_projections(
    months: Annotated[int, Query(ge=1, le=MAX_MONTHS)] = 24,
    uid: int = Depends(require_auth),
) -> list[dict]:
    """Project each savings account's balance forward under monthly compounding
    of its interest rate, for ``months`` ahead (default 24).

    Returns the full monthly series plus 1/2/5-year milestones per account. Each
    account's figures stay in its own currency (no base conversion here).
    """
    with db() as conn:
        rows = conn.execute(
            f"""
            SELECT a.id, a.name, a.interest_rate, a.color, a.currency, b.balance_cents
            FROM accounts a
            {_LATEST_BALANCE_JOIN}
            WHERE a.type = 'savings' AND a.user_id = ?
        """,
            (uid,),
        ).fetchall()

    now = datetime.now(timezone.utc)
    projections: list[dict] = []
    for row in rows:
        bal = from_cents(row["balance_cents"]) or 0.0
        mr = (row["interest_rate"] / 100) / 12
        points = [
            {
                "date": (now + timedelta(days=m * 30.44)).strftime("%Y-%m-%d"),
                "balance": round(bal * math.pow(1 + mr, m), 2),
            }
            for m in range(months + 1)
        ]
        projections.append(
            {
                "id": row["id"],
                "name": row["name"],
                "color": row["color"],
                "currency": row["currency"] or "GBP",
                "initial_balance": bal,
                "interest_rate": row["interest_rate"],
                "1yr": round(bal * math.pow(1 + mr, 12), 2),
                "2yr": round(bal * math.pow(1 + mr, 24), 2),
                "5yr": round(bal * math.pow(1 + mr, 60), 2),
                "points": points,
            }
        )
    return projections
