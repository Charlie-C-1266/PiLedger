"""Password hashing, session management, and the require_auth dependency."""

from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import secrets

from fastapi import Cookie, Header, HTTPException

from constants import ISO_FMT, SESSION_COOKIE, SESSION_DAYS
from db import db, utcnow_iso


_DUMMY_HASH: Optional[str] = None


def hash_password(password: str) -> str:
    """Hash a password with PBKDF2-SHA256 (260k iterations) and a fresh 16-byte
    salt, returning a ``salt:hexdigest`` string for storage."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"{salt}:{key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of ``password`` against a stored ``salt:hexdigest``.

    Uses ``secrets.compare_digest`` so the comparison doesn't leak timing, and
    returns False on any malformed stored value rather than raising.
    """
    try:
        salt, key_hex = stored.split(":", 1)
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


def dummy_hash() -> str:
    """Return a cached hash of a fixed dummy password.

    Login verifies against this when the username is unknown, so PBKDF2 runs on
    every attempt and the response latency doesn't reveal whether an account
    exists (a user-enumeration timing defence).
    """
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("__piledger_dummy__")
    return _DUMMY_HASH


def make_session(user_id: int) -> str:
    """Create a session for ``user_id`` and return its token.

    Generates a 32-byte token, stores it with a ``SESSION_DAYS`` expiry, and
    opportunistically purges already-expired rows on the way through. The token
    is what gets set as the session cookie.
    """
    token = secrets.token_hex(32)
    now = utcnow_iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).strftime(
        ISO_FMT
    )
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        conn.execute(
            "INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)",
            (token, user_id, expires),
        )
        conn.commit()
    return token


def session_uid(token: Optional[str]) -> Optional[int]:
    """Return the user id for a live session token, or None if the token is
    missing, unknown, or past its expiry."""
    if not token:
        return None
    now = utcnow_iso()
    with db() as conn:
        row = conn.execute(
            "SELECT user_id FROM sessions WHERE token=? AND expires_at>?", (token, now)
        ).fetchone()
    return row["user_id"] if row else None


def token_uid(authorization: Optional[str]) -> Optional[int]:
    """Return the user id for a live ``Authorization: Bearer <token>`` header,
    or None if the header is missing, malformed, or the token is unknown.

    On a hit, opportunistically bumps ``last_used_at`` — but only when it's
    more than 60 seconds stale, so token auth doesn't cost a DB write on
    every request.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    raw = authorization.removeprefix("Bearer ").strip()
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    with db() as conn:
        row = conn.execute(
            "SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash=?",
            (token_hash,),
        ).fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc)
        last = row["last_used_at"]
        if last is None or now - datetime.strptime(last, ISO_FMT).replace(
            tzinfo=timezone.utc
        ) > timedelta(seconds=60):
            conn.execute(
                "UPDATE api_tokens SET last_used_at=? WHERE id=?",
                (utcnow_iso(), row["id"]),
            )
            conn.commit()
        return int(row["user_id"])


def require_session_auth(
    session: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
) -> int:
    """FastAPI dependency resolving the session cookie only — never a bearer
    token. Used to gate the token-management routes themselves, so a leaked
    API token can never mint, list, or revoke tokens.

    Raises ``HTTPException(401)`` when there is no valid, unexpired session.
    """
    uid = session_uid(session)
    if not uid:
        raise HTTPException(401, "Not authenticated")
    return uid


def require_auth(
    session: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    authorization: Optional[str] = Header(None),
) -> int:
    """FastAPI dependency resolving either a bearer token or the session
    cookie to a user id, trying the token first.

    Raises ``HTTPException(401)`` when neither resolves to a live user.
    """
    uid = token_uid(authorization)
    if uid is None:
        uid = session_uid(session)
    if not uid:
        raise HTTPException(401, "Not authenticated")
    return uid
