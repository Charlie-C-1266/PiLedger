"""PiLedger — self-hosted finance dashboard.

Money is stored as integer cents in SQLite; the JSON API exposes plain
floating-point dollars to keep the frontend contract unchanged.

This module wires the FastAPI app and HTTP routes. Supporting code lives in:
    constants.py — bounds, type aliases, cookie + path settings
    db.py        — connection, schema init/migrations, money helpers
    auth.py      — password hashing, sessions, require_auth dependency
    schemas.py   — Pydantic request/response models
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional
import math
import sqlite3
import uuid

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from constants import (
    FREQ_TO_MONTHLY,
    ISO_FMT,
    MAX_DAYS,
    MAX_MONTHS,
    RANGE_TO_DAYS,
    RangeKey,
    STATIC_DIR,
    SUBTYPES_BY_TYPE,
    VERSION,
)
from db import (
    db,
    from_cents,
    init,
    to_cents,
    utcnow_iso,
)
from security import SecurityHeadersMiddleware
from auth import (
    require_auth,
)
from schemas import (
    AccountIn,
    AccountOut,
    AccountPatch,
    BalanceEntryOut,
    BalanceIn,
    BudgetItemIn,
    BudgetItemOut,
    BudgetItemPatch,
    GoalIn,
    GoalOut,
    GoalPatch,
    HistoryAccountOut,
    HistoryPointOut,
    NetWorthPointOut,
    OkOut,
    PrefsOut,
    PrefsPatch,
    RateOut,
    RatesOut,
    RatesPut,
    SummaryOut,
    TransactionIn,
    TransactionOut,
    TransactionPatch,
    TransferIn,
)
from limiter import limiter
from services.accounts import _adjust_account_balance, _require_account
from services.currency import _convert_to_base, _load_rates, _rescale_rates

from routers import auth as auth_router
from routers import categories, ops, pages


# `docs_url=None` / `redoc_url=None` / `openapi_url=None` disable FastAPI's
# default unauthenticated mounts. The replacements below (`/docs`, `/redoc`,
# `/api/openapi.json`) all gate on the session cookie, so an anonymous scanner
# cannot fingerprint the API surface — only logged-in users see Swagger /
# ReDoc. This matches the P0-10 design (path 2: gate rather than fully
# disable, because self-hosters routinely log in to inspect their own API).
app = FastAPI(
    title="PiLedger",
    version=VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SecurityHeadersMiddleware)
init()


# Pydantic validation failures default to 422, but the public contract documented
# in README + CHANGELOG returns 400 for bad input. Translate them so callers see
# the documented status code.
@app.exception_handler(RequestValidationError)
def _validation_to_400(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Pydantic puts the raw exception in `ctx` for model-level validators; that
    # object is not JSON-serializable, so coerce ctx values to strings before
    # returning.
    safe = []
    for err in exc.errors():
        e = dict(err)
        if "ctx" in e and isinstance(e["ctx"], dict):
            e["ctx"] = {k: str(v) for k, v in e["ctx"].items()}
        safe.append(e)
    return JSONResponse(status_code=400, content={"detail": safe})


# ─── User preferences ─────────────────────────────────────────────────────────


def _prefs_out(row: sqlite3.Row) -> PrefsOut:
    return PrefsOut(
        theme=row["theme"] or "olive",
        dark_mode=bool(row["dark_mode"]),
        base_currency=row["base_currency"] or "GBP",
    )


@app.get("/api/prefs", response_model=PrefsOut)
def get_prefs(uid: int = Depends(require_auth)) -> PrefsOut:
    with db() as conn:
        row = conn.execute(
            "SELECT theme, dark_mode, base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
    if not row:
        raise HTTPException(404)
    return _prefs_out(row)


@app.put("/api/prefs", response_model=PrefsOut)
def update_prefs(
    data: PrefsPatch,
    uid: int = Depends(require_auth),
) -> PrefsOut:
    patch = data.model_dump(exclude_none=True)
    if "dark_mode" in patch:
        # SQLite has no native bool, store as 0/1
        patch["dark_mode"] = int(patch["dark_mode"])
    with db() as conn:
        # Changing the base currency invalidates any prior rates (which were
        # expressed against the previous base). Re-scale them so each stored
        # rate continues to mean "1 unit of currency = rate units of base".
        # Old base gains a row (its rate in the new base) unless it equals new
        # base; new base itself never has a row (implicit 1.0).
        if "base_currency" in patch:
            old = conn.execute(
                "SELECT base_currency FROM users WHERE id=?", (uid,)
            ).fetchone()
            old_base = (old["base_currency"] if old else None) or "GBP"
            new_base = patch["base_currency"]
            if new_base != old_base:
                _rescale_rates(conn, uid, old_base, new_base)
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(f"UPDATE users SET {sets} WHERE id=?", [*patch.values(), uid])
            conn.commit()
        row = conn.execute(
            "SELECT theme, dark_mode, base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
    return _prefs_out(row)


# ─── Exchange rates ───────────────────────────────────────────────────────────


@app.get("/api/rates", response_model=RatesOut)
def get_rates(uid: int = Depends(require_auth)) -> RatesOut:
    with db() as conn:
        row = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        rows = conn.execute(
            "SELECT currency, rate, updated_at FROM exchange_rates"
            " WHERE user_id=? ORDER BY currency",
            (uid,),
        ).fetchall()
    base = (row["base_currency"] if row else None) or "GBP"
    return RatesOut(
        base_currency=base,
        rates=[
            RateOut(
                currency=r["currency"],
                rate=float(r["rate"]),
                updated_at=r["updated_at"],
            )
            for r in rows
        ],
    )


@app.put("/api/rates", response_model=RatesOut)
def put_rates(data: RatesPut, uid: int = Depends(require_auth)) -> RatesOut:
    """Replace the user's full rates table. Rates against the user's own base
    currency are rejected — base is implicitly 1.0 and storing it would create
    ambiguity if the base is later changed."""
    with db() as conn:
        row = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        base = (row["base_currency"] if row else None) or "GBP"
        # Validate up-front so a partial write never happens.
        seen: set[str] = set()
        for r in data.rates:
            if r.currency == base:
                raise HTTPException(
                    400, "Cannot set a rate against the base currency itself"
                )
            if r.currency in seen:
                raise HTTPException(400, f"Duplicate rate for currency '{r.currency}'")
            seen.add(r.currency)
        conn.execute("DELETE FROM exchange_rates WHERE user_id=?", (uid,))
        now = utcnow_iso()
        for r in data.rates:
            conn.execute(
                "INSERT INTO exchange_rates(user_id, currency, rate, updated_at)"
                " VALUES(?,?,?,?)",
                (uid, r.currency, r.rate, now),
            )
        conn.commit()
        rows = conn.execute(
            "SELECT currency, rate, updated_at FROM exchange_rates"
            " WHERE user_id=? ORDER BY currency",
            (uid,),
        ).fetchall()
    return RatesOut(
        base_currency=base,
        rates=[
            RateOut(
                currency=r["currency"],
                rate=float(r["rate"]),
                updated_at=r["updated_at"],
            )
            for r in rows
        ],
    )


# ─── Accounts ─────────────────────────────────────────────────────────────────


def _account_row_to_out(row: sqlite3.Row) -> AccountOut:
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
        currency=row["currency"] or "GBP",
        interest_rate=row["interest_rate"],
        color=row["color"],
        created_at=row["created_at"],
        current_balance=from_cents(row["current_balance_cents"])
        if "current_balance_cents" in row.keys()
        else None,
        last_updated=row["last_updated"] if "last_updated" in row.keys() else None,
    )


@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(uid: int = Depends(require_auth)) -> list[AccountOut]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT a.*,
                   b.balance_cents AS current_balance_cents,
                   b.recorded_at   AS last_updated
            FROM accounts a
            LEFT JOIN balance_history b ON b.id = (
                SELECT id FROM balance_history WHERE account_id = a.id
                ORDER BY recorded_at DESC, id DESC LIMIT 1
            )
            WHERE a.user_id = ?
            ORDER BY a.created_at
        """,
            (uid,),
        ).fetchall()
    return [_account_row_to_out(r) for r in rows]


@app.post("/api/accounts", status_code=201, response_model=AccountOut)
def create_account(data: AccountIn, uid: int = Depends(require_auth)) -> AccountOut:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO accounts(user_id, name, type, subtype, currency, interest_rate, color)"
            " VALUES(?,?,?,?,?,?,?)",
            (
                uid,
                data.name,
                data.type,
                data.subtype,
                data.currency,
                data.interest_rate,
                data.color,
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
        created_at=row["created_at"],
        current_balance=None,
        last_updated=None,
    )


@app.put("/api/accounts/{aid}", response_model=AccountOut)
def update_account(
    aid: int,
    data: AccountPatch,
    uid: int = Depends(require_auth),
) -> AccountOut:
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
        created_at=row["created_at"],
    )


@app.delete("/api/accounts/{aid}", response_model=OkOut)
def delete_account(aid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM accounts WHERE id=?", (aid,))
        conn.commit()
    return OkOut(ok=True)


# ─── Balance history ──────────────────────────────────────────────────────────


@app.post("/api/accounts/{aid}/balance", response_model=OkOut)
def record_balance(
    aid: int,
    data: BalanceIn,
    uid: int = Depends(require_auth),
) -> OkOut:
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


@app.get("/api/accounts/{aid}/history", response_model=list[BalanceEntryOut])
def get_history(
    aid: int,
    days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 90,
    uid: int = Depends(require_auth),
) -> list[BalanceEntryOut]:
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


# ─── Dashboard APIs ───────────────────────────────────────────────────────────


@app.get("/api/summary", response_model=SummaryOut)
def get_summary(uid: int = Depends(require_auth)) -> SummaryOut:
    with db() as conn:
        user = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
        rows = conn.execute(
            """
            SELECT a.type, a.currency, b.balance_cents
            FROM accounts a
            LEFT JOIN balance_history b ON b.id = (
                SELECT id FROM balance_history WHERE account_id=a.id
                ORDER BY recorded_at DESC, id DESC LIMIT 1
            )
            WHERE a.user_id = ?
        """,
            (uid,),
        ).fetchall()
        rates = _load_rates(conn, uid)
    base = (user["base_currency"] if user else None) or "GBP"
    current_t = savings_t = loans_t = credit_t = invest_t = 0.0
    missing: set[str] = set()
    for r in rows:
        cur = r["currency"] or "GBP"
        amt = (r["balance_cents"] or 0) / 100
        if cur != base and cur not in rates:
            missing.add(cur)
        converted = _convert_to_base(amt, cur, base, rates)
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
    return SummaryOut(
        total=round(assets - debts, 2),
        total_current=round(current_t, 2),
        total_savings=round(savings_t, 2),
        total_loans=round(loans_t, 2),
        total_credit=round(credit_t, 2),
        total_invest=round(invest_t, 2),
        assets=assets,
        debts=debts,
        savings_rate=savings_rate,
        account_count=len(rows),
        base_currency=base,
        missing_rates=sorted(missing),
    )


@app.get("/api/history/all", response_model=list[HistoryAccountOut])
def all_history(
    days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 90,
    uid: int = Depends(require_auth),
) -> list[HistoryAccountOut]:
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


@app.get("/api/history/networth", response_model=list[NetWorthPointOut])
def networth_history(
    range_key: RangeKey = Query(default="30D", alias="range"),
    uid: int = Depends(require_auth),
) -> list[NetWorthPointOut]:
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
                "SELECT id, type, currency FROM accounts WHERE user_id=?", (uid,)
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


@app.get("/api/projections")
def get_projections(
    months: Annotated[int, Query(ge=1, le=MAX_MONTHS)] = 24,
    uid: int = Depends(require_auth),
) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT a.id, a.name, a.interest_rate, a.color, a.currency, b.balance_cents
            FROM accounts a
            LEFT JOIN balance_history b ON b.id = (
                SELECT id FROM balance_history WHERE account_id=a.id
                ORDER BY recorded_at DESC, id DESC LIMIT 1
            )
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


# ─── Budget items ─────────────────────────────────────────────────────────────


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


@app.get("/api/budget", response_model=list[BudgetItemOut])
def list_budget_items(uid: int = Depends(require_auth)) -> list[BudgetItemOut]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM budget_items WHERE user_id=? ORDER BY account_id, created_at",
            (uid,),
        ).fetchall()
    return [_budget_row_to_out(r) for r in rows]


@app.post("/api/budget", status_code=201, response_model=BudgetItemOut)
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


@app.put("/api/budget/{bid}", response_model=BudgetItemOut)
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


@app.delete("/api/budget/{bid}", response_model=OkOut)
def delete_budget_item(bid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM budget_items WHERE id=? AND user_id=?", (bid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM budget_items WHERE id=?", (bid,))
        conn.commit()
    return OkOut(ok=True)


@app.get("/api/budget/projection")
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


# ─── Transactions ────────────────────────────────────────────────────────────


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


@app.get("/api/transactions", response_model=list[TransactionOut])
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


@app.post("/api/transactions", status_code=201, response_model=TransactionOut)
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


@app.post("/api/transfers", status_code=201, response_model=list[TransactionOut])
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


@app.put("/api/transactions/{tid}", response_model=TransactionOut)
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


@app.delete("/api/transactions/{tid}", response_model=OkOut)
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


# ─── Goals ───────────────────────────────────────────────────────────────────


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


@app.get("/api/goals", response_model=list[GoalOut])
def list_goals(uid: int = Depends(require_auth)) -> list[GoalOut]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM goals WHERE user_id=? ORDER BY created_at", (uid,)
        ).fetchall()
        return [_goal_row_to_out(conn, r) for r in rows]


@app.post("/api/goals", status_code=201, response_model=GoalOut)
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


@app.put("/api/goals/{gid}", response_model=GoalOut)
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


@app.delete("/api/goals/{gid}", response_model=OkOut)
def delete_goal(gid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM goals WHERE id=? AND user_id=?", (gid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM goals WHERE id=?", (gid,))
        conn.commit()
    return OkOut(ok=True)


# ─── API routers ──────────────────────────────────────────────────────────────
#
# `pages` (the SPA shell + PWA assets) is included last so a page route can
# never shadow an API path. Each migrated resource moves here one router at a
# time; see the refactor plan. The remaining inline @app routes above are
# pending migration.
app.include_router(auth_router.router)
app.include_router(categories.router)
app.include_router(ops.router)
app.include_router(pages.router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
