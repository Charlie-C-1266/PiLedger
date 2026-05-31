"""Zero-based envelope budget — read API.

`GET /api/budget` returns the user's manual income lines, their envelope groups
(each with its envelopes), and a 6-month budget-vs-actual history. Budgeted and
income figures are user-entered and stored monthly; each envelope's `spent` is
computed live from the current month's negative transactions in that envelope's
category, converted into the user's base currency via ``services/currency``.

The trend `history` compares each of the last six months' actual spend (across
enveloped categories) against the *current* total allocation — we don't snapshot
historical plans, so the budgeted line is a flat present-day reference.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from db import db, from_cents
from auth import require_auth
from schemas import (
    BudgetEnvelopeOut,
    BudgetGroupOut,
    BudgetHistoryPoint,
    BudgetIncomeOut,
    BudgetOut,
)
from services.currency import _convert_to_base, _load_rates

router = APIRouter(tags=["budget"])

_HISTORY_MONTHS = 6


def _month_keys(now: datetime, count: int) -> list[str]:
    """The last ``count`` month keys ("YYYY-MM"), oldest first, ending on the
    month containing ``now`` (which is therefore the last element)."""
    keys: list[str] = []
    for i in range(count - 1, -1, -1):
        year, month = now.year, now.month - i
        while month <= 0:
            month += 12
            year -= 1
        keys.append(f"{year:04d}-{month:02d}")
    return keys


@router.get("/api/budget", response_model=BudgetOut)
def get_budget(uid: int = Depends(require_auth)) -> BudgetOut:
    now = datetime.now(timezone.utc)
    months = _month_keys(now, _HISTORY_MONTHS)
    current_key = months[-1]
    # Start of the oldest month in the window — occurred_at is a normalised,
    # lexically-sortable ISO string, so a string comparison is a date comparison.
    window_start = f"{months[0]}-01T00:00:00Z"

    with db() as conn:
        user = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        base = (user["base_currency"] if user else None) or "GBP"
        rates = _load_rates(conn, uid)

        income_rows = conn.execute(
            "SELECT id, label, amount_cents, sort_order FROM budget_income"
            " WHERE user_id=? ORDER BY sort_order, id",
            (uid,),
        ).fetchall()
        group_rows = conn.execute(
            "SELECT id, name, color, flexible, sort_order FROM budget_group"
            " WHERE user_id=? ORDER BY sort_order, id",
            (uid,),
        ).fetchall()
        envelope_rows = conn.execute(
            "SELECT id, group_id, label, category, budgeted_cents, sort_order"
            " FROM budget_envelope WHERE user_id=? ORDER BY sort_order, id",
            (uid,),
        ).fetchall()

        # Negative transactions since the window start, with each account's
        # currency so amounts can be converted to base before summing.
        txn_rows = conn.execute(
            "SELECT t.occurred_at, t.category, t.amount_cents, a.currency"
            " FROM transactions t JOIN accounts a ON a.id = t.account_id"
            " WHERE t.user_id=? AND t.amount_cents < 0 AND t.occurred_at >= ?",
            (uid, window_start),
        ).fetchall()

    enveloped = {e["category"] for e in envelope_rows}

    # Bucket spend (in base currency) by category for the current month, and by
    # month across all enveloped categories for the trend.
    missing: set[str] = set()
    spent_by_category: dict[str, float] = {}
    spent_by_month: dict[str, float] = {}
    for t in txn_rows:
        cur = t["currency"] or "GBP"
        if cur != base and cur not in rates:
            missing.add(cur)
        amount = _convert_to_base(abs(t["amount_cents"]) / 100, cur, base, rates)
        month_key = t["occurred_at"][:7]
        if month_key == current_key:
            spent_by_category[t["category"]] = (
                spent_by_category.get(t["category"], 0.0) + amount
            )
        if t["category"] in enveloped:
            spent_by_month[month_key] = spent_by_month.get(month_key, 0.0) + amount

    envelopes_by_group: dict[int, list[BudgetEnvelopeOut]] = {}
    for e in envelope_rows:
        envelopes_by_group.setdefault(e["group_id"], []).append(
            BudgetEnvelopeOut(
                id=e["id"],
                group_id=e["group_id"],
                label=e["label"],
                category=e["category"],
                budgeted=from_cents(e["budgeted_cents"]) or 0.0,
                spent=round(spent_by_category.get(e["category"], 0.0), 2),
                sort_order=e["sort_order"],
            )
        )

    groups = [
        BudgetGroupOut(
            id=g["id"],
            name=g["name"],
            color=g["color"],
            flexible=bool(g["flexible"]),
            sort_order=g["sort_order"],
            envelopes=envelopes_by_group.get(g["id"], []),
        )
        for g in group_rows
    ]
    incomes = [
        BudgetIncomeOut(
            id=i["id"],
            label=i["label"],
            amount=from_cents(i["amount_cents"]) or 0.0,
            sort_order=i["sort_order"],
        )
        for i in income_rows
    ]

    # Trend only makes sense once something is budgeted; an empty budget has no
    # allocation line to compare against, so it returns no history points.
    if envelope_rows:
        allocation = round(
            sum(from_cents(e["budgeted_cents"]) or 0.0 for e in envelope_rows), 2
        )
        history = [
            BudgetHistoryPoint(
                month=key,
                budgeted=allocation,
                spent=round(spent_by_month.get(key, 0.0), 2),
            )
            for key in months
        ]
    else:
        history = []

    return BudgetOut(
        incomes=incomes,
        groups=groups,
        history=history,
        base_currency=base,
        missing_rates=sorted(missing),
    )
