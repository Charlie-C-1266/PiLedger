"""FinDash — self-hosted finance dashboard.

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

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from constants import (
    COOKIE_SECURE,
    FREQ_TO_MONTHLY,
    ISO_FMT,
    MAX_DAYS,
    MAX_MONTHS,
    SESSION_COOKIE,
    SESSION_DAYS,
    SUBTYPES_BY_TYPE,
)
from db import db, from_cents, init, to_cents, utcnow_iso
from auth import (
    dummy_hash,
    hash_password,
    make_session,
    require_auth,
    session_uid,
    verify_password,
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
    HistoryAccountOut,
    HistoryPointOut,
    LoginIn,
    LoginOut,
    OkOut,
    PrefsOut,
    PrefsPatch,
    RegisterIn,
    RegisterOut,
    SummaryOut,
    UserOut,
)


app = FastAPI(title="FinDash")
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


# ─── Auth routes ──────────────────────────────────────────────────────────────

@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse("static/login.html")


@app.post("/api/auth/register", status_code=201, response_model=RegisterOut)
def register(data: RegisterIn) -> RegisterOut:
    with db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users(username, password_hash) VALUES(?,?)",
                (data.username, hash_password(data.password)),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Username already taken")
        return RegisterOut(id=cur.lastrowid, username=data.username)


@app.post("/api/auth/login", response_model=LoginOut)
def login(data: LoginIn, response: Response) -> LoginOut:
    username = data.username.strip()
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    stored = user["password_hash"] if user else dummy_hash()
    ok = verify_password(data.password, stored)
    if not user or not ok:
        raise HTTPException(401, "Invalid username or password")
    token = make_session(user["id"])
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        path="/",
        secure=COOKIE_SECURE,
    )
    return LoginOut(ok=True, username=user["username"])


@app.post("/api/auth/logout", response_model=OkOut)
def logout(
    response: Response,
    session: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
) -> OkOut:
    if session:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (session,))
            conn.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return OkOut(ok=True)


@app.get("/api/auth/me", response_model=UserOut)
def get_me(uid: int = Depends(require_auth)) -> UserOut:
    with db() as conn:
        user = conn.execute("SELECT id, username FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        raise HTTPException(404)
    return UserOut(id=user["id"], username=user["username"])


# ─── User preferences ─────────────────────────────────────────────────────────

@app.get("/api/prefs", response_model=PrefsOut)
def get_prefs(uid: int = Depends(require_auth)) -> PrefsOut:
    with db() as conn:
        row = conn.execute(
            "SELECT theme, dark_mode FROM users WHERE id=?", (uid,)
        ).fetchone()
    if not row:
        raise HTTPException(404)
    return PrefsOut(theme=row["theme"] or "olive", dark_mode=bool(row["dark_mode"]))


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
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(f"UPDATE users SET {sets} WHERE id=?", [*patch.values(), uid])
            conn.commit()
        row = conn.execute(
            "SELECT theme, dark_mode FROM users WHERE id=?", (uid,)
        ).fetchone()
    return PrefsOut(theme=row["theme"] or "olive", dark_mode=bool(row["dark_mode"]))


# ─── Accounts ─────────────────────────────────────────────────────────────────

def _account_row_to_out(row: sqlite3.Row) -> AccountOut:
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
        interest_rate=row["interest_rate"],
        color=row["color"],
        created_at=row["created_at"],
        current_balance=from_cents(row["current_balance_cents"]) if "current_balance_cents" in row.keys() else None,
        last_updated=row["last_updated"] if "last_updated" in row.keys() else None,
    )


@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(uid: int = Depends(require_auth)) -> list[AccountOut]:
    with db() as conn:
        rows = conn.execute("""
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
        """, (uid,)).fetchall()
    return [_account_row_to_out(r) for r in rows]


@app.post("/api/accounts", status_code=201, response_model=AccountOut)
def create_account(data: AccountIn, uid: int = Depends(require_auth)) -> AccountOut:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO accounts(user_id, name, type, subtype, interest_rate, color)"
            " VALUES(?,?,?,?,?,?)",
            (uid, data.name, data.type, data.subtype, data.interest_rate, data.color),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)).fetchone()
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
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
        if "subtype" in updates and updates["subtype"] not in SUBTYPES_BY_TYPE[existing["type"]]:
            raise HTTPException(
                400,
                f"subtype '{updates['subtype']}' is not valid for type '{existing['type']}'",
            )
        if updates:
            sets = ", ".join(f"{k}=?" for k in updates)
            conn.execute(f"UPDATE accounts SET {sets} WHERE id=?", [*updates.values(), aid])
            conn.commit()
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (aid,)).fetchone()
    return AccountOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        type=row["type"],
        subtype=row["subtype"] or "general",
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
        rows = conn.execute("""
            SELECT a.type, b.balance_cents
            FROM accounts a
            LEFT JOIN balance_history b ON b.id = (
                SELECT id FROM balance_history WHERE account_id=a.id
                ORDER BY recorded_at DESC, id DESC LIMIT 1
            )
            WHERE a.user_id = ?
        """, (uid,)).fetchall()
    current_c = sum((r["balance_cents"] or 0) for r in rows if r["type"] == "current")
    savings_c = sum((r["balance_cents"] or 0) for r in rows if r["type"] == "savings")
    loans_c   = sum((r["balance_cents"] or 0) for r in rows if r["type"] == "loan")
    return SummaryOut(
        # Net worth: assets minus liabilities
        total=(current_c + savings_c - loans_c) / 100,
        total_current=current_c / 100,
        total_savings=savings_c / 100,
        total_loans=loans_c / 100,
        account_count=len(rows),
    )


@app.get("/api/history/all", response_model=list[HistoryAccountOut])
def all_history(
    days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 90,
    uid: int = Depends(require_auth),
) -> list[HistoryAccountOut]:
    with db() as conn:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime(ISO_FMT)
        accounts = conn.execute(
            "SELECT id, name, color, type FROM accounts WHERE user_id=?", (uid,)
        ).fetchall()
        result: list[HistoryAccountOut] = []
        for a in accounts:
            hist = conn.execute(
                "SELECT balance_cents, recorded_at FROM balance_history"
                " WHERE account_id=? AND recorded_at>=? ORDER BY recorded_at",
                (a["id"], since),
            ).fetchall()
            if hist:
                result.append(HistoryAccountOut(
                    id=a["id"], name=a["name"], color=a["color"], type=a["type"],
                    history=[
                        HistoryPointOut(
                            balance=from_cents(h["balance_cents"]) or 0.0,
                            date=h["recorded_at"],
                        ) for h in hist
                    ],
                ))
    return result


@app.get("/api/projections")
def get_projections(
    months: Annotated[int, Query(ge=1, le=MAX_MONTHS)] = 24,
    uid: int = Depends(require_auth),
) -> list[dict]:
    with db() as conn:
        rows = conn.execute("""
            SELECT a.id, a.name, a.interest_rate, a.color, b.balance_cents
            FROM accounts a
            LEFT JOIN balance_history b ON b.id = (
                SELECT id FROM balance_history WHERE account_id=a.id
                ORDER BY recorded_at DESC, id DESC LIMIT 1
            )
            WHERE a.type = 'savings' AND a.user_id = ?
        """, (uid,)).fetchall()

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
        projections.append({
            "id": row["id"], "name": row["name"], "color": row["color"],
            "initial_balance": bal,
            "interest_rate": row["interest_rate"],
            "1yr": round(bal * math.pow(1 + mr, 12), 2),
            "2yr": round(bal * math.pow(1 + mr, 24), 2),
            "5yr": round(bal * math.pow(1 + mr, 60), 2),
            "points": points,
        })
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
        row = conn.execute("SELECT * FROM budget_items WHERE id=?", (cur.lastrowid,)).fetchone()
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
            conn.execute(f"UPDATE budget_items SET {sets} WHERE id=?", [*patch.values(), bid])
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
        accounts = conn.execute("""
            SELECT a.id, a.name, a.type, a.interest_rate, a.color,
                   b.balance_cents AS current_balance_cents
            FROM accounts a
            LEFT JOIN balance_history b ON b.id = (
                SELECT id FROM balance_history WHERE account_id=a.id
                ORDER BY recorded_at DESC, id DESC LIMIT 1
            )
            WHERE a.user_id = ?
            ORDER BY a.created_at
        """, (uid,)).fetchall()

        items = conn.execute(
            "SELECT account_id, amount_cents, frequency FROM budget_items WHERE user_id=?",
            (uid,),
        ).fetchall()

    # Sum all budget items into a monthly net flow per account (in dollars).
    monthly_net: dict[int, float] = {}
    for item in items:
        flow = from_cents(item["amount_cents"]) * FREQ_TO_MONTHLY[item["frequency"]]
        monthly_net[item["account_id"]] = monthly_net.get(item["account_id"], 0.0) + flow

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

        result.append({
            "id":              acc["id"],
            "name":            acc["name"],
            "type":            acc["type"],
            "color":           acc["color"],
            "current_balance": from_cents(acc["current_balance_cents"]),
            "monthly_net":     round(net, 2),
            "points":          points,
            "final_balance":   points[-1]["balance"],
        })

    # Net worth at each month: assets minus liabilities.
    net_worth: list[dict] = []
    for m in range(months + 1):
        nw = 0.0
        for acc in result:
            v = acc["points"][m]["balance"]
            nw += -v if acc["type"] == "loan" else v
        date = result[0]["points"][m]["date"] if result else now.strftime("%Y-%m-%d")
        net_worth.append({"month": m, "balance": round(nw, 2), "date": date})

    return {"months": months, "accounts": result, "net_worth": net_worth}


# ─── Serve SPA ────────────────────────────────────────────────────────────────

@app.get("/")
def root(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    if not session_uid(session):
        return RedirectResponse("/login", status_code=302)
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
