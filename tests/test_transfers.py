"""Account-to-account transfers (POST /api/transfers).

A transfer is recorded as two linked transactions sharing a transfer_id:
`-amount` on the source and `+amount` on the destination. Balances move on
both sides, net worth is unchanged, and deleting either leg removes both.
"""


def _make_account(client, name, type_="current", currency="GBP"):
    return client.post(
        "/api/accounts", json={"name": name, "type": type_, "currency": currency}
    ).json()["id"]


def _balances(client):
    return {a["id"]: a["current_balance"] for a in client.get("/api/accounts").json()}


def test_transfer_requires_auth(client):
    r = client.post(
        "/api/transfers",
        json={"from_account_id": 1, "to_account_id": 2, "amount": 10.0},
    )
    assert r.status_code == 401


def test_transfer_moves_balance_between_accounts(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    alice.post(f"/api/accounts/{a}/balance", json={"balance": 1000.0})
    alice.post(f"/api/accounts/{b}/balance", json={"balance": 500.0})

    r = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 200.0},
    )
    assert r.status_code == 201

    bal = _balances(alice)
    assert bal[a] == 800.0
    assert bal[b] == 700.0


def test_transfer_normalises_occurred_at_offset_to_utc(alice):
    """TransferIn.occurred_at runs through the shared ISO normaliser, so both
    legs are stamped in canonical UTC."""
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    alice.post(f"/api/accounts/{a}/balance", json={"balance": 1000.0})

    r = alice.post(
        "/api/transfers",
        json={
            "from_account_id": a,
            "to_account_id": b,
            "amount": 100.0,
            "occurred_at": "2025-01-15T12:00:00+05:00",
        },
    )
    assert r.status_code == 201
    legs = r.json()
    assert [leg["occurred_at"] for leg in legs] == [
        "2025-01-15T07:00:00Z",
        "2025-01-15T07:00:00Z",
    ]


def test_transfer_leaves_net_worth_unchanged(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    alice.post(f"/api/accounts/{a}/balance", json={"balance": 1000.0})
    alice.post(f"/api/accounts/{b}/balance", json={"balance": 500.0})
    before = alice.get("/api/summary").json()["total"]

    alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 200.0},
    )
    after = alice.get("/api/summary").json()["total"]
    assert before == after == 1500.0


def test_transfer_creates_two_linked_transactions(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")

    created = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 200.0},
    ).json()
    assert len(created) == 2
    tid = created[0]["transfer_id"]
    assert tid and all(t["transfer_id"] == tid for t in created)
    assert all(t["category"] == "Transfer" for t in created)

    by_account = {t["account_id"]: t for t in created}
    assert by_account[a]["amount"] == -200.0
    assert by_account[a]["merchant"] == "Transfer to Savings"
    assert by_account[b]["amount"] == 200.0
    assert by_account[b]["merchant"] == "Transfer from Current"


def test_transfer_to_same_account_rejected(alice):
    a = _make_account(alice, "Current")
    r = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": a, "amount": 50.0},
    )
    assert r.status_code == 400


def test_transfer_between_different_currencies_rejected(alice):
    a = _make_account(alice, "GBP acct", currency="GBP")
    b = _make_account(alice, "USD acct", currency="USD")
    r = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 50.0},
    )
    assert r.status_code == 400


def test_transfer_nonpositive_amount_rejected(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    for amount in (0, -10):
        r = alice.post(
            "/api/transfers",
            json={"from_account_id": a, "to_account_id": b, "amount": amount},
        )
        # Pydantic 422s are translated to 400 by the app's validation handler.
        assert r.status_code == 400


def test_transfer_to_account_of_another_user_rejected(alice, bob):
    a = _make_account(alice, "Alice Current")
    b_other = _make_account(bob, "Bob Current")
    r = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b_other, "amount": 50.0},
    )
    assert r.status_code == 404


def test_deleting_one_leg_deletes_both_and_restores_balances(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    alice.post(f"/api/accounts/{a}/balance", json={"balance": 1000.0})
    alice.post(f"/api/accounts/{b}/balance", json={"balance": 500.0})

    created = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 200.0},
    ).json()

    # Delete just one leg.
    assert alice.delete(f"/api/transactions/{created[0]['id']}").status_code == 200

    # Both legs gone.
    assert alice.get("/api/transactions").json() == []
    # Balances back to where they started.
    bal = _balances(alice)
    assert bal[a] == 1000.0
    assert bal[b] == 500.0


def test_transfer_leg_cannot_be_edited(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    created = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 200.0},
    ).json()
    r = alice.put(f"/api/transactions/{created[0]['id']}", json={"amount": 999.0})
    assert r.status_code == 400


# ── Closed accounts (#171) ──────────────────────────────────────────────────


def test_transfer_from_closed_account_rejected(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    alice.put(f"/api/accounts/{a}", json={"closed": True})
    r = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 50.0},
    )
    assert r.status_code == 400


def test_transfer_to_closed_account_rejected(alice):
    a = _make_account(alice, "Current")
    b = _make_account(alice, "Savings", "savings")
    alice.put(f"/api/accounts/{b}", json={"closed": True})
    r = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 50.0},
    )
    assert r.status_code == 400
