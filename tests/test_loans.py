"""
Tests for loan account support.

Loans are stored with positive balances (representing the amount owed) and
contribute negatively to net worth.
"""


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
