"""Money boundary conversion: ``to_cents`` / ``from_cents``.

``to_cents`` rounds the decimal value the user typed (half away from zero), not
its binary-float approximation, so half-cent inputs like 2.675 don't silently
drop a cent. These pin that behavior at the unit level and through the API.
"""

import pytest

from db import from_cents, to_cents


@pytest.mark.parametrize(
    "dollars, cents",
    [
        (2.675, 268),  # float-artefact case: 2.675 is stored as 2.67499…
        (-2.675, -268),  # symmetric: rounds away from zero on both signs
        (2.005, 201),  # another half-cent that the old round() dropped to 200
        (0.005, 1),  # smallest half-cent rounds up
        (-0.005, -1),
        (0.1, 10),
        (10.0, 1000),
        (0, 0),
        (1234.56, 123456),
        (-1234.55, -123455),
        (1_000_000_000_000.0, 100_000_000_000_000),  # MAX_MONEY stays exact
    ],
)
def test_to_cents_rounds_half_away_from_zero(dollars, cents):
    assert to_cents(dollars) == cents


def test_from_cents_inverts_clean_values():
    assert from_cents(123456) == 1234.56
    assert from_cents(0) == 0.0
    assert from_cents(-123455) == -1234.55


def test_from_cents_preserves_none():
    assert from_cents(None) is None


def test_half_cent_amount_survives_transaction_round_trip(alice):
    """End to end: posting an amount whose cents would be lost by float rounding
    stores and reads back the rounded-up value."""
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    created = alice.post(
        "/api/transactions",
        json={"account_id": aid, "amount": 2.675, "merchant": "Shop"},
    ).json()
    assert created["amount"] == 2.68
    fetched = alice.get("/api/transactions").json()[0]
    assert fetched["amount"] == 2.68
