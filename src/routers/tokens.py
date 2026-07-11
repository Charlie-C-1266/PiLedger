"""Personal access tokens — mint, list, revoke.

Session-cookie only (``require_session_auth``): a leaked bearer token must
never be able to mint, list, or revoke tokens for the account it belongs to.
"""

import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException

from auth import require_session_auth
from db import db, utcnow_iso
from schemas import OkOut, TokenCreate, TokenCreatedOut, TokenOut

router = APIRouter(tags=["tokens"])


@router.post("/api/tokens", status_code=201, response_model=TokenCreatedOut)
def create_token(
    data: TokenCreate, uid: int = Depends(require_session_auth)
) -> TokenCreatedOut:
    """Mint a new personal access token for the user.

    The raw ``pil_...`` value is returned in this response only — the table
    stores just its SHA-256 hash, so it can never be recovered afterwards.
    """
    raw = "pil_" + secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    now = utcnow_iso()
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO api_tokens(user_id, name, token_hash, created_at)"
            " VALUES(?,?,?,?)",
            (uid, data.name, token_hash, now),
        )
        conn.commit()
    return TokenCreatedOut(
        id=cur.lastrowid, name=data.name, created_at=now, last_used_at=None, token=raw
    )


@router.get("/api/tokens", response_model=list[TokenOut])
def list_tokens(uid: int = Depends(require_session_auth)) -> list[TokenOut]:
    """List the user's tokens, newest first — never the raw token value."""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, created_at, last_used_at FROM api_tokens"
            " WHERE user_id=? ORDER BY created_at DESC",
            (uid,),
        ).fetchall()
    return [
        TokenOut(
            id=r["id"],
            name=r["name"],
            created_at=r["created_at"],
            last_used_at=r["last_used_at"],
        )
        for r in rows
    ]


@router.delete("/api/tokens/{token_id}", response_model=OkOut)
def revoke_token(token_id: int, uid: int = Depends(require_session_auth)) -> OkOut:
    """Revoke one of the user's tokens (404 if not theirs)."""
    with db() as conn:
        if not conn.execute(
            "SELECT 1 FROM api_tokens WHERE id=? AND user_id=?", (token_id, uid)
        ).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM api_tokens WHERE id=?", (token_id,))
        conn.commit()
    return OkOut(ok=True)
