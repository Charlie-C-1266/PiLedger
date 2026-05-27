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
import os
import sqlite3
import time

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from constants import (
    COOKIE_SECURE,
    DOCS_DIR,
    DOC_SLUGS,
    FREQ_TO_MONTHLY,
    ISO_FMT,
    LOGIN_RATE_LIMIT,
    MAX_DAYS,
    MAX_MONTHS,
    RANGE_TO_DAYS,
    RangeKey,
    SESSION_COOKIE,
    SESSION_DAYS,
    SUBTYPES_BY_TYPE,
    VERSION,
)
from db import (
    USER_SCOPED_TABLES,
    db,
    from_cents,
    init,
    to_cents,
    user_scoped_delete_sql,
    user_scoped_select_sql,
    utcnow_iso,
)
from security import SecurityHeadersMiddleware
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
    DeleteMeIn,
    GoalIn,
    GoalOut,
    GoalPatch,
    HistoryAccountOut,
    HistoryPointOut,
    LoginIn,
    LoginOut,
    NetWorthPointOut,
    OkOut,
    PasswordChangeIn,
    PrefsOut,
    PrefsPatch,
    RateOut,
    RatesOut,
    RatesPut,
    RegisterIn,
    RegisterOut,
    SummaryOut,
    TransactionIn,
    TransactionOut,
    TransactionPatch,
    UserOut,
)


# Login rate limiter. Key function is the socket peer IP (slowapi default),
# which means behind a reverse proxy every client shares a single bucket —
# the README directs internet-exposed deployments to add nginx `limit_req`
# / Caddy `rate_limit` at the proxy layer where real client IPs are visible.
# This app-layer limit is defence-in-depth for LAN deployments. Configurable
# via the PILEDGER_LOGIN_RATE_LIMIT env var (see constants.py).
limiter = Limiter(key_func=get_remote_address)

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

# Monotonic clock so `/healthz` uptime never goes backwards on a wall-clock
# adjustment. Captured at import time, which is effectively process start.
_BOOT_MONOTONIC = time.monotonic()

# Resolve static asset paths relative to this module rather than the process
# CWD so the app is invocable from any working directory (start.sh, the
# Docker entrypoint, IDE runners, and direct `uvicorn --app-dir src` all
# end up pointing at the same files).
_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


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


# ─── Ops endpoints ────────────────────────────────────────────────────────────


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    """Liveness + version probe for uptime monitors and the Docker healthcheck.

    Deliberately unauthenticated — uptime monitors (Uptime Kuma,
    Healthchecks.io, kube probes) need to poll without holding a session,
    and the response carries no sensitive information beyond the version
    string. Returns `uptime_s` as an int so log scrapers don't have to
    handle floats."""
    return {
        "ok": True,
        "version": VERSION,
        "uptime_s": int(time.monotonic() - _BOOT_MONOTONIC),
    }


@app.get("/api/openapi.json", include_in_schema=False)
def openapi_schema(uid: int = Depends(require_auth)) -> dict:
    """Auth-gated OpenAPI spec. The default `/openapi.json` is disabled in
    the FastAPI constructor; this replacement is fed to the gated Swagger /
    ReDoc UIs below. `app.openapi()` is FastAPI's spec-builder method and
    works regardless of whether the default route is mounted."""
    return app.openapi()


@app.get("/docs", include_in_schema=False)
def swagger_ui(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    """Swagger UI for logged-in users; redirects to /login for everyone else.

    Mirrors the behaviour of `GET /` rather than 401-ing — a browser user
    hitting /docs sees a familiar login page, not a JSON error blob."""
    if not session_uid(session):
        return RedirectResponse("/login", status_code=302)
    return get_swagger_ui_html(
        openapi_url="/api/openapi.json",
        title="PiLedger API docs",
    )


@app.get("/redoc", include_in_schema=False)
def redoc_ui(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    """ReDoc for logged-in users; redirects to /login for everyone else."""
    if not session_uid(session):
        return RedirectResponse("/login", status_code=302)
    return get_redoc_html(
        openapi_url="/api/openapi.json",
        title="PiLedger API docs",
    )


# ─── Auth routes ──────────────────────────────────────────────────────────────


@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse(os.path.join(_STATIC_DIR, "login.html"))


@app.get("/guide", include_in_schema=False)
def guide_page() -> FileResponse:
    """Public documentation viewer — accessible without authentication."""
    return FileResponse(os.path.join(_STATIC_DIR, "guide.html"))


@app.get("/api/docs/{slug}", include_in_schema=False)
def get_doc(slug: str) -> FileResponse:
    """Serve a raw markdown doc file by slug. Public — no auth required.

    The slug is validated against a fixed allowlist to prevent path traversal.
    Returns text/markdown so the frontend can parse it client-side."""
    if slug not in DOC_SLUGS:
        raise HTTPException(404, "Document not found")
    path = os.path.join(DOCS_DIR, f"{slug}.md")
    if not os.path.isfile(path):
        raise HTTPException(404, "Document not found")
    return FileResponse(path, media_type="text/markdown")


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
@limiter.limit(LOGIN_RATE_LIMIT)
def login(request: Request, data: LoginIn, response: Response) -> LoginOut:
    username = data.username.strip()
    with db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username=?", (username,)
        ).fetchone()
    stored = user["password_hash"] if user else dummy_hash()
    ok = verify_password(data.password, stored)
    if not user or not ok:
        raise HTTPException(401, "Invalid username or password")
    token = make_session(user["id"])
    response.set_cookie(
        SESSION_COOKIE,
        token,
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
        user = conn.execute(
            "SELECT id, username FROM users WHERE id=?", (uid,)
        ).fetchone()
    if not user:
        raise HTTPException(404)
    return UserOut(id=user["id"], username=user["username"])


@app.put("/api/auth/password", response_model=OkOut)
def change_password(
    data: PasswordChangeIn,
    response: Response,
    uid: int = Depends(require_auth),
) -> OkOut:
    """Change the authenticated user's password, then rotate every session.

    The session rotation is the load-bearing piece: if a separate device's
    session token has been stolen (or even just left signed-in on a public
    machine), changing the password from this device should kick the other
    one out. Implemented as DELETE-then-INSERT rather than UPDATE — the new
    token is unrelated to the old one, so even a leaked old token cookie
    can't be repurposed if the row is somehow reanimated. The new cookie
    written on this response is what keeps the *current* browser logged in
    seamlessly after the rotation.
    """
    with db() as conn:
        user = conn.execute(
            "SELECT password_hash FROM users WHERE id=?", (uid,)
        ).fetchone()
        if not user or not verify_password(
            data.current_password, user["password_hash"]
        ):
            raise HTTPException(401, "Current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(data.new_password), uid),
        )
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        conn.commit()
    # `make_session` opens its own connection; running it after the explicit
    # commit above guarantees the rotation is visible before the new token
    # row is inserted (i.e. the new row can't be torn down by the bulk
    # DELETE racing inside the same transaction).
    token = make_session(uid)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        path="/",
        secure=COOKIE_SECURE,
    )
    return OkOut(ok=True)


@app.delete("/api/auth/me", response_model=OkOut)
def delete_me(
    data: DeleteMeIn,
    response: Response,
    uid: int = Depends(require_auth),
) -> OkOut:
    """Self-serve account deletion. Re-verifies the password to defend against
    XSS-driven CSRF (a stolen session cookie alone can't trigger a wipe), then
    cascades every user-scoped table before deleting the `users` row.

    The cascade is intentionally explicit (one DELETE per table in
    `USER_SCOPED_TABLES`) rather than relying on the schema's
    `ON DELETE CASCADE` foreign keys alone. Reasons:
      * Defence in depth — a future migration that adds a user-scoped table
        without an `ON DELETE CASCADE` FK still gets wiped.
      * Visibility — the cascade is readable in `app.py` rather than buried
        in `db.py`, and the guard test in `tests/test_export.py` catches any
        new user-scoped table missing from `USER_SCOPED_TABLES`.
    """
    with db() as conn:
        user = conn.execute(
            "SELECT password_hash FROM users WHERE id=?", (uid,)
        ).fetchone()
        if not user or not verify_password(data.password, user["password_hash"]):
            raise HTTPException(401, "Invalid password")
        for table in USER_SCOPED_TABLES:
            conn.execute(user_scoped_delete_sql(table), (uid,))
        # `sessions.user_id` has ON DELETE CASCADE so the users-row delete
        # below would clear them, but doing it explicitly here means any
        # other valid session for this user is killed in the same
        # transaction, before the users row vanishes.
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        conn.execute("DELETE FROM users WHERE id=?", (uid,))
        conn.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return OkOut(ok=True)


@app.get("/api/export")
def export_data(uid: int = Depends(require_auth)) -> JSONResponse:
    """Return every row owned by the authenticated user as JSON.

    The shape is `{version, exported_at, user, <table>: [...rows], ...}` —
    one key per table in `USER_SCOPED_TABLES` plus the user row itself
    (without the password hash). The `Content-Disposition: attachment`
    header makes browsers save the response rather than render it.
    """
    now = utcnow_iso()
    with db() as conn:
        user_row = conn.execute(
            "SELECT id, username, theme, dark_mode, base_currency, created_at"
            " FROM users WHERE id=?",
            (uid,),
        ).fetchone()
        if not user_row:
            raise HTTPException(404, "Not found")
        payload: dict = {
            "version": 1,
            "exported_at": now,
            "user": dict(user_row),
        }
        for table in USER_SCOPED_TABLES:
            rows = conn.execute(user_scoped_select_sql(table), (uid,)).fetchall()
            payload[table] = [dict(r) for r in rows]
    filename = f"piledger-export-{user_row['username']}-{now[:10]}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


def _load_rates(conn: sqlite3.Connection, uid: int) -> dict[str, float]:
    """Return {currency: rate_to_base} for a user. The base currency is omitted
    (it is implicitly 1.0)."""
    rows = conn.execute(
        "SELECT currency, rate FROM exchange_rates WHERE user_id=?", (uid,)
    ).fetchall()
    return {r["currency"]: float(r["rate"]) for r in rows}


def _rescale_rates(
    conn: sqlite3.Connection, uid: int, old_base: str, new_base: str
) -> None:
    """Recompute the rates table so every stored rate is now expressed
    against ``new_base`` instead of ``old_base``. Rates missing the pivot
    are dropped — we can't infer them safely."""
    existing = _load_rates(conn, uid)
    pivot = existing.get(new_base)  # 1 new_base = pivot old_base
    conn.execute("DELETE FROM exchange_rates WHERE user_id=?", (uid,))
    if not pivot:
        return  # no way to rescale; user will need to re-enter rates
    now = utcnow_iso()
    # Old base in the new world: 1 old_base = 1/pivot new_base.
    conn.execute(
        "INSERT INTO exchange_rates(user_id, currency, rate, updated_at) VALUES(?,?,?,?)",
        (uid, old_base, 1.0 / pivot, now),
    )
    for cur, rate in existing.items():
        if cur in (new_base, old_base):
            continue
        # 1 cur = rate old_base = rate/pivot new_base.
        conn.execute(
            "INSERT INTO exchange_rates(user_id, currency, rate, updated_at) VALUES(?,?,?,?)",
            (uid, cur, rate / pivot, now),
        )


def _convert_to_base(
    amount: float, currency: str, base: str, rates: dict[str, float]
) -> float:
    """Convert ``amount`` of ``currency`` into ``base`` using the user's rates.
    Missing rates fall back to 1.0 so the total is never silently dropped; the
    /api/summary response flags the affected currencies so the UI can warn."""
    if currency == base:
        return amount
    return amount * rates.get(currency, 1.0)


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
            loans_t += converted
        elif r["type"] == "credit":
            credit_t += converted
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
                nw -= converted
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
    "date": "occurred_at DESC, id DESC",
    "amount": "ABS(amount_cents) DESC, id DESC",
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
        cur = conn.execute(
            "INSERT INTO transactions(user_id, account_id, amount_cents,"
            " occurred_at, merchant, category, note) VALUES(?,?,?,?,?,?,?)",
            (
                uid,
                data.account_id,
                to_cents(data.amount),
                ts,
                data.merchant,
                data.category,
                data.note,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM transactions WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _txn_row_to_out(row)


@app.put("/api/transactions/{tid}", response_model=TransactionOut)
def update_transaction(
    tid: int,
    data: TransactionPatch,
    uid: int = Depends(require_auth),
) -> TransactionOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM transactions WHERE id=? AND user_id=?", (tid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
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
            conn.commit()
        row = conn.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()
    return _txn_row_to_out(row)


@app.delete("/api/transactions/{tid}", response_model=OkOut)
def delete_transaction(tid: int, uid: int = Depends(require_auth)) -> OkOut:
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM transactions WHERE id=? AND user_id=?", (tid, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM transactions WHERE id=?", (tid,))
        conn.commit()
    return OkOut(ok=True)


# ─── Goals ───────────────────────────────────────────────────────────────────


def _goal_row_to_out(row: sqlite3.Row) -> GoalOut:
    return GoalOut(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        target=from_cents(row["target_cents"]) or 0.0,
        saved=from_cents(row["saved_cents"]) or 0.0,
        monthly=from_cents(row["monthly_cents"]) or 0.0,
        color=row["color"],
        created_at=row["created_at"],
    )


@app.get("/api/goals", response_model=list[GoalOut])
def list_goals(uid: int = Depends(require_auth)) -> list[GoalOut]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM goals WHERE user_id=? ORDER BY created_at", (uid,)
        ).fetchall()
    return [_goal_row_to_out(r) for r in rows]


@app.post("/api/goals", status_code=201, response_model=GoalOut)
def create_goal(data: GoalIn, uid: int = Depends(require_auth)) -> GoalOut:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO goals(user_id, name, target_cents, saved_cents,"
            " monthly_cents, color) VALUES(?,?,?,?,?,?)",
            (
                uid,
                data.name,
                to_cents(data.target),
                to_cents(data.saved),
                to_cents(data.monthly),
                data.color,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM goals WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _goal_row_to_out(row)


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
        patch = data.model_dump(exclude_none=True)
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
    return _goal_row_to_out(row)


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


# ─── Serve SPA ────────────────────────────────────────────────────────────────

_DIST_INDEX = os.path.join(_STATIC_DIR, "dist", "index.html")


def _serve_spa(session: Optional[str]) -> Response:
    if not session_uid(session):
        return RedirectResponse("/login", status_code=302)
    if not os.path.isfile(_DIST_INDEX):
        raise HTTPException(
            503,
            "Frontend not built. Run: cd frontend && npm ci && npm run build",
        )
    return FileResponse(_DIST_INDEX)


@app.get("/")
def root(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    return _serve_spa(session)


@app.get("/overview")
@app.get("/accounts")
@app.get("/transactions")
@app.get("/goals")
@app.get("/settings")
def spa_routes(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    return _serve_spa(session)


app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
