"""Password hashing, session management, and the require_auth dependency."""
from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import secrets

from fastapi import Cookie, HTTPException

from constants import ISO_FMT, SESSION_COOKIE, SESSION_DAYS
from db import db, utcnow_iso


_DUMMY_HASH: Optional[str] = None


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"{salt}:{key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, key_hex = stored.split(":", 1)
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


def dummy_hash() -> str:
    # Run PBKDF2 against a stable known-bad hash so login latency doesn't leak
    # whether a username exists.
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("__findash_dummy__")
    return _DUMMY_HASH


def make_session(user_id: int) -> str:
    token = secrets.token_hex(32)
    now = utcnow_iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).strftime(ISO_FMT)
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        conn.execute(
            "INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)",
            (token, user_id, expires),
        )
        conn.commit()
    return token


def session_uid(token: Optional[str]) -> Optional[int]:
    if not token:
        return None
    now = utcnow_iso()
    with db() as conn:
        row = conn.execute(
            "SELECT user_id FROM sessions WHERE token=? AND expires_at>?", (token, now)
        ).fetchone()
    return row["user_id"] if row else None


def require_auth(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)) -> int:
    uid = session_uid(session)
    if not uid:
        raise HTTPException(401, "Not authenticated")
    return uid
