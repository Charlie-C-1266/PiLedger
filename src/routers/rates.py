"""Per-user exchange rates, each expressed as units-of-base per unit-of-currency.

The user's own base currency is implicitly 1.0 and may not be stored, so a rate
against it is rejected.
"""

from fastapi import APIRouter, Depends, HTTPException

from db import db, utcnow_iso
from auth import require_auth
from schemas import RateOut, RatesOut, RatesPut

router = APIRouter(tags=["rates"])


@router.get("/api/rates", response_model=RatesOut)
def get_rates(uid: int = Depends(require_auth)) -> RatesOut:
    """Return the user's base currency and their stored exchange rates (sorted by
    currency). The base currency is implicit 1.0 and never appears in the list."""
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


@router.put("/api/rates", response_model=RatesOut)
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
