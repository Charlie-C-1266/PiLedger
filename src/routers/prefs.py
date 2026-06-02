"""User preferences: theme, dark mode, base currency.

Changing the base currency rescales the stored exchange rates via
``services/currency._rescale_rates`` so each rate keeps meaning "1 unit =
rate units of base".
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth import require_auth
from schemas import PrefsOut, PrefsPatch
from services.currency import _rescale_rates

router = APIRouter(tags=["prefs"])


def _prefs_out(row: sqlite3.Row) -> PrefsOut:
    """Map a ``users`` row to ``PrefsOut``, defaulting legacy NULLs and coercing
    the 0/1 ``dark_mode`` column to a bool."""
    return PrefsOut(
        theme=row["theme"] or "olive",
        dark_mode=bool(row["dark_mode"]),
        base_currency=row["base_currency"] or "GBP",
    )


@router.get("/api/prefs", response_model=PrefsOut)
def get_prefs(uid: int = Depends(require_auth)) -> PrefsOut:
    """Return the user's display preferences (theme, dark mode, base currency)."""
    with db() as conn:
        row = conn.execute(
            "SELECT theme, dark_mode, base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
    if not row:
        raise HTTPException(404)
    return _prefs_out(row)


@router.put("/api/prefs", response_model=PrefsOut)
def update_prefs(
    data: PrefsPatch,
    uid: int = Depends(require_auth),
) -> PrefsOut:
    """Patch the supplied preference fields and return the updated set.

    Changing ``base_currency`` re-scales the stored exchange rates (via
    ``_rescale_rates``) so each keeps meaning "1 unit = rate units of base".
    """
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
