"""User preferences: base currency.

Changing the base currency rescales the stored exchange rates via
``services/currency._rescale_rates`` so each rate keeps meaning "1 unit =
rate units of base". The switch is rejected (400) when the rates can't be
rescaled — i.e. there are rates but none for the incoming base to pivot on —
rather than silently discarding the whole table.

Theme and light/dark mode used to live here too, but the React client owns
those entirely now (persisted in ``localStorage``), so this endpoint carries
only ``base_currency``.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth import require_auth
from schemas import PrefsOut, PrefsPatch
from services.currency import _rescale_rates

router = APIRouter(tags=["prefs"])


def _prefs_out(row: sqlite3.Row) -> PrefsOut:
    """Map a ``users`` row to ``PrefsOut``, defaulting a legacy NULL base
    currency to GBP."""
    return PrefsOut(base_currency=row["base_currency"] or "GBP")


@router.get("/api/prefs", response_model=PrefsOut)
def get_prefs(uid: int = Depends(require_auth)) -> PrefsOut:
    """Return the user's preferences (base currency)."""
    with db() as conn:
        row = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
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
                # Rescaling pivots on the new base's rate against the old base.
                # Without that pivot the stored rates can't be re-expressed and
                # would simply be discarded — silent data loss. Reject instead,
                # so the user adds the missing rate (or clears rates) on purpose.
                rate_currencies = {
                    r["currency"]
                    for r in conn.execute(
                        "SELECT currency FROM exchange_rates WHERE user_id=?", (uid,)
                    ).fetchall()
                }
                if rate_currencies and new_base not in rate_currencies:
                    raise HTTPException(
                        400,
                        f"Add an exchange rate for {new_base} before making it your "
                        "base currency, or clear your rates first — switching now "
                        "would discard the rates that can't be rescaled.",
                    )
                _rescale_rates(conn, uid, old_base, new_base)
        if patch:
            sets = ", ".join(f"{k}=?" for k in patch)
            conn.execute(f"UPDATE users SET {sets} WHERE id=?", [*patch.values(), uid])
            conn.commit()
        row = conn.execute(
            "SELECT base_currency FROM users WHERE id=?", (uid,)
        ).fetchone()
    return _prefs_out(row)
