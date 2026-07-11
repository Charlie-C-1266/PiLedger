"""Authentication, account lifecycle, and data export.

Login page, register/login/logout, the current-user endpoint, password change,
self-serve account deletion, and the full-data JSON export. `/api/auth/login`
is rate-limited via the shared limiter (see src/limiter.py).

Note: ``from auth import ...`` below resolves to the top-level ``src/auth.py``
(hashing/sessions), not this module — Python 3 absolute imports key off the
full module name, which for this file is ``routers.auth``.
"""

import os
import sqlite3
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from constants import (
    COOKIE_SECURE,
    EXPORT_EXCLUDED_TABLES,
    LOGIN_RATE_LIMIT,
    SESSION_COOKIE,
    SESSION_DAYS,
    STATIC_DIR,
)
from db import (
    USER_SCOPED_TABLES,
    db,
    user_scoped_delete_sql,
    user_scoped_select_sql,
    utcnow_iso,
)
from auth import (
    dummy_hash,
    hash_password,
    make_session,
    require_auth,
    verify_password,
)
from schemas import (
    DeleteMeIn,
    LoginIn,
    LoginOut,
    OkOut,
    PasswordChangeIn,
    RegisterIn,
    RegisterOut,
    UserOut,
)
from limiter import limiter

router = APIRouter(tags=["auth"])


@router.get("/login")
def login_page() -> FileResponse:
    """Serve the standalone login page (a static HTML file outside the SPA)."""
    return FileResponse(os.path.join(STATIC_DIR, "login.html"))


@router.post("/api/auth/register", status_code=201, response_model=RegisterOut)
def register(data: RegisterIn) -> RegisterOut:
    """Create a new user with a hashed password, returning 409 if the username
    is already taken (enforced by the UNIQUE constraint)."""
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


@router.post("/api/auth/login", response_model=LoginOut)
@limiter.limit(LOGIN_RATE_LIMIT)
def login(request: Request, data: LoginIn, response: Response) -> LoginOut:
    """Authenticate a user and set the session cookie on success.

    On an unknown username the password is still checked against a dummy hash so
    the response timing doesn't leak whether the account exists, and both
    failure modes return the same 401. Rate-limited via the shared limiter.
    """
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


@router.post("/api/auth/logout", response_model=OkOut)
def logout(
    response: Response,
    session: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
) -> OkOut:
    """Delete the current session row (if any) and clear the session cookie."""
    if session:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (session,))
            conn.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return OkOut(ok=True)


@router.get("/api/auth/me", response_model=UserOut)
def get_me(uid: int = Depends(require_auth)) -> UserOut:
    """Return the authenticated user's id and username (the client's auth probe)."""
    with db() as conn:
        user = conn.execute(
            "SELECT id, username FROM users WHERE id=?", (uid,)
        ).fetchone()
    if not user:
        raise HTTPException(404)
    return UserOut(id=user["id"], username=user["username"])


@router.put("/api/auth/password", response_model=OkOut)
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


@router.delete("/api/auth/me", response_model=OkOut)
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
      * Visibility — the cascade is readable here rather than buried in
        `db.py`, and the guard test in `tests/test_export.py` catches any
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


@router.get("/api/export")
def export_data(uid: int = Depends(require_auth)) -> JSONResponse:
    """Return every row owned by the authenticated user as JSON.

    The shape is `{version, exported_at, user, <table>: [...rows], ...}` —
    one key per table in `USER_SCOPED_TABLES` (minus `EXPORT_EXCLUDED_TABLES`)
    plus the user row itself (without the password hash). The
    `Content-Disposition: attachment` header makes browsers save the response
    rather than render it.
    """
    now = utcnow_iso()
    with db() as conn:
        user_row = conn.execute(
            "SELECT id, username, base_currency, created_at FROM users WHERE id=?",
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
            if table in EXPORT_EXCLUDED_TABLES:
                continue
            rows = conn.execute(user_scoped_select_sql(table), (uid,)).fetchall()
            payload[table] = [dict(r) for r in rows]
    filename = f"piledger-export-{user_row['username']}-{now[:10]}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
