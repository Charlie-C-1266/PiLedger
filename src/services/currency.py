"""FX conversion helpers shared across routers (prefs, rates, dashboard, budget).

Rates are stored per user as ``{currency: rate_to_base}`` with the base
currency omitted (it is implicitly 1.0).
"""

import sqlite3

from db import utcnow_iso


def load_rates(conn: sqlite3.Connection, uid: int) -> dict[str, float]:
    """Return {currency: rate_to_base} for a user. The base currency is omitted
    (it is implicitly 1.0)."""
    rows = conn.execute(
        "SELECT currency, rate FROM exchange_rates WHERE user_id=?", (uid,)
    ).fetchall()
    return {r["currency"]: float(r["rate"]) for r in rows}


def rescale_rates(
    conn: sqlite3.Connection, uid: int, old_base: str, new_base: str
) -> None:
    """Recompute the rates table so every stored rate is now expressed
    against ``new_base`` instead of ``old_base``. Rates missing the pivot
    are dropped — we can't infer them safely."""
    existing = load_rates(conn, uid)
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


def convert_to_base(
    amount: float, currency: str, base: str, rates: dict[str, float]
) -> float:
    """Convert ``amount`` of ``currency`` into ``base`` using the user's rates.
    Missing rates fall back to 1.0 so the total is never silently dropped; the
    /api/summary response flags the affected currencies so the UI can warn."""
    if currency == base:
        return amount
    return amount * rates.get(currency, 1.0)
