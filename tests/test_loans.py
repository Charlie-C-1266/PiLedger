"""
Tests for loan account support.

Loans are stored with positive balances (representing the amount owed) and
contribute negatively to net worth. Interest accrues against the balance and
budget items (typically negative — payments) reduce it.
"""

import math


# ── Account creation ──────────────────────────────────────────────────────────


def test_create_loan_account(alice):
    resp = alice.post(
        "/api/accounts",
        json={
            "name": "Mortgage",
            "type": "loan",
            "interest_rate": 5.0,
            "color": "#ef4444",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["type"] == "loan"
    assert body["interest_rate"] == 5.0


def test_invalid_type_still_rejected(alice):
    resp = alice.post("/api/accounts", json={"name": "X", "type": "crypto"})
    assert resp.status_code == 400


def test_loan_appears_in_account_list(alice):
    alice.post(
        "/api/accounts", json={"name": "Car loan", "type": "loan", "interest_rate": 6.5}
    )
    accounts = alice.get("/api/accounts").json()
    assert any(a["type"] == "loan" and a["name"] == "Car loan" for a in accounts)


# ── Net worth (summary) ───────────────────────────────────────────────────────


def test_summary_includes_total_loans(alice):
    body = alice.get("/api/summary").json()
    assert "total_loans" in body
    assert body["total_loans"] == 0.0


def test_loan_subtracts_from_net_worth(alice):
    cur = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    sav = alice.post("/api/accounts", json={"name": "Saver", "type": "savings"}).json()[
        "id"
    ]
    mtg = alice.post("/api/accounts", json={"name": "Mortgage", "type": "loan"}).json()[
        "id"
    ]

    alice.post(f"/api/accounts/{cur}/balance", json={"balance": 5_000.0})
    alice.post(f"/api/accounts/{sav}/balance", json={"balance": 10_000.0})
    alice.post(f"/api/accounts/{mtg}/balance", json={"balance": 200_000.0})

    body = alice.get("/api/summary").json()
    assert body["total_current"] == 5_000.0
    assert body["total_savings"] == 10_000.0
    assert body["total_loans"] == 200_000.0
    # Net worth = 5000 + 10000 - 200000 = -185000
    assert body["total"] == -185_000.0
    assert body["account_count"] == 3


def test_summary_loans_only_negative_net_worth(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "Credit card", "type": "loan"}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 3_500.0})
    body = alice.get("/api/summary").json()
    assert body["total"] == -3_500.0


def test_loan_user_isolation(alice, bob):
    aid = alice.post(
        "/api/accounts", json={"name": "Alice's loan", "type": "loan"}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 50_000.0})
    body = bob.get("/api/summary").json()
    assert body["total_loans"] == 0.0
    assert body["total"] == 0.0


# ── Budget projection ─────────────────────────────────────────────────────────


def test_loan_interest_accrues_with_no_payments(alice):
    """A loan with no budget items grows by its interest rate each month."""
    aid = alice.post(
        "/api/accounts", json={"name": "Mortgage", "type": "loan", "interest_rate": 6.0}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 100_000.0})

    proj = alice.get("/api/budget/projection?months=3").json()
    loan = next(a for a in proj["accounts"] if a["id"] == aid)

    # Same monthly-compounding formula as savings:
    # bal_m = (bal_{m-1} + 0) * (1 + 0.06/12) = bal_{m-1} * 1.005
    expected_3mo = round(100_000.0 * math.pow(1 + 0.06 / 12, 3), 2)
    assert loan["points"][3]["balance"] == expected_3mo


def test_loan_payment_reduces_balance(alice):
    """A loan with a payment large enough to exceed interest should reduce in balance."""
    aid = alice.post(
        "/api/accounts", json={"name": "Mortgage", "type": "loan", "interest_rate": 5.0}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 200_000.0})
    # Negative amount represents balance decrease (loan payment)
    alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Monthly payment",
            "amount": -1_200.0,
            "frequency": "monthly",
        },
    )

    proj = alice.get("/api/budget/projection?months=3").json()
    loan = next(a for a in proj["accounts"] if a["id"] == aid)

    # After 3 months, the balance should be lower than the starting 200,000
    assert loan["points"][3]["balance"] < 200_000.0
    assert loan["monthly_net"] == -1_200.0


def test_projection_includes_net_worth_array(alice):
    cur = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    mtg = alice.post(
        "/api/accounts", json={"name": "Mortgage", "type": "loan", "interest_rate": 5.0}
    ).json()["id"]
    alice.post(f"/api/accounts/{cur}/balance", json={"balance": 10_000.0})
    alice.post(f"/api/accounts/{mtg}/balance", json={"balance": 200_000.0})

    proj = alice.get("/api/budget/projection?months=6").json()
    assert "net_worth" in proj
    assert len(proj["net_worth"]) == 7  # months 0 through 6
    # Month 0: 10,000 - 200,000 = -190,000
    assert proj["net_worth"][0]["balance"] == -190_000.0


def test_net_worth_is_zero_across_all_months_when_no_accounts(alice):
    proj = alice.get("/api/budget/projection?months=3").json()
    assert proj["accounts"] == []
    assert len(proj["net_worth"]) == 4  # months 0 through 3
    assert all(p["balance"] == 0.0 for p in proj["net_worth"])


def test_net_worth_with_only_assets_equals_sum(alice):
    cur = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    sav = alice.post("/api/accounts", json={"name": "Saver", "type": "savings"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{cur}/balance", json={"balance": 1_500.0})
    alice.post(f"/api/accounts/{sav}/balance", json={"balance": 8_000.0})

    proj = alice.get("/api/budget/projection?months=3").json()
    assert proj["net_worth"][0]["balance"] == 9_500.0


def test_loan_budget_item_round_trip(alice):
    """Create, list, and delete a budget item against a loan account."""
    aid = alice.post(
        "/api/accounts", json={"name": "Car loan", "type": "loan", "interest_rate": 6.0}
    ).json()["id"]
    item = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Repayment",
            "amount": -350.0,
            "frequency": "monthly",
        },
    ).json()

    items = alice.get("/api/budget").json()
    assert any(i["id"] == item["id"] and i["account_id"] == aid for i in items)

    alice.delete(f"/api/budget/{item['id']}")
    assert all(i["id"] != item["id"] for i in alice.get("/api/budget").json())
