"""
Edge-case and boundary tests: unusual values, multi-step flows,
and scenarios that sit at the boundary of normal operation.
"""

import math


# ── Balance boundary values ───────────────────────────────────────────────────


def test_balance_of_zero_is_stored_and_shown(alice):
    aid = alice.post("/api/accounts", json={"name": "Empty", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 0.0})
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    # 0.0 is a valid balance, distinct from None (no balance recorded)
    assert acc["current_balance"] == 0.0


def test_very_large_balance_is_stored_accurately(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "BigBucks", "type": "current"}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 9_999_999.99})
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert acc["current_balance"] == 9_999_999.99


def test_summary_totals_five_accounts_accurately(alice):
    for i in range(5):
        aid = alice.post(
            "/api/accounts", json={"name": f"A{i}", "type": "current"}
        ).json()["id"]
        alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    body = alice.get("/api/summary").json()
    assert body["total"] == 5000.0
    assert body["account_count"] == 5


# ── Character handling ────────────────────────────────────────────────────────


def test_account_name_with_special_characters(alice):
    name = "O'Brien & Sons <Test>"
    resp = alice.post("/api/accounts", json={"name": name, "type": "current"})
    assert resp.status_code == 201
    assert alice.get("/api/accounts").json()[0]["name"] == name


def test_account_name_with_unicode(alice):
    name = "Épargne — Crédit Agricole"
    resp = alice.post(
        "/api/accounts", json={"name": name, "type": "savings", "interest_rate": 2.0}
    )
    assert resp.status_code == 201
    assert alice.get("/api/accounts").json()[0]["name"] == name


# ── Interest rate edge cases ──────────────────────────────────────────────────


def test_interest_rate_fractional_precision(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Saver", "type": "savings", "interest_rate": 4.75},
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    proj = alice.get("/api/projections?months=12").json()[0]
    expected = round(1000.0 * math.pow(1 + (4.75 / 100) / 12, 12), 2)
    assert proj["1yr"] == expected


def test_high_interest_rate_does_not_crash(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "HighRate", "type": "savings", "interest_rate": 99.9},
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    resp = alice.get("/api/projections?months=60")
    assert resp.status_code == 200
    assert resp.json()[0]["5yr"] > 1000.0


def test_projection_milestone_values_are_consistent(alice):
    """The 1yr/2yr/5yr values must match the corresponding point in the points array."""
    aid = alice.post(
        "/api/accounts", json={"name": "S", "type": "savings", "interest_rate": 4.0}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 5000.0})
    proj = alice.get("/api/projections?months=60").json()[0]
    assert proj["points"][12]["balance"] == proj["1yr"]
    assert proj["points"][24]["balance"] == proj["2yr"]
    assert proj["points"][60]["balance"] == proj["5yr"]


# ── Multi-step flows ──────────────────────────────────────────────────────────


def test_delete_then_create_new_account_has_no_leftover_balance(alice):
    aid = alice.post("/api/accounts", json={"name": "Temp", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 500.0})
    alice.delete(f"/api/accounts/{aid}")

    new_aid = alice.post(
        "/api/accounts", json={"name": "New", "type": "current"}
    ).json()["id"]
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == new_aid)
    assert acc["current_balance"] is None


def test_balance_sequence_only_latest_counts_in_summary(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "savings"}).json()[
        "id"
    ]
    for amount in (100.0, 200.0, 300.0, 400.0, 500.0):
        alice.post(f"/api/accounts/{aid}/balance", json={"balance": amount})
    body = alice.get("/api/summary").json()
    assert body["total_savings"] == 500.0  # not 1500 (sum of all entries)


def test_update_account_does_not_affect_balance_history(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "Old Name", "type": "current"}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 750.0})
    alice.put(f"/api/accounts/{aid}", json={"name": "New Name"})
    entries = alice.get(f"/api/accounts/{aid}/history").json()
    assert len(entries) == 1
    assert entries[0]["balance"] == 750.0


# ── Username edge cases ───────────────────────────────────────────────────────


def test_all_uppercase_username_conflicts_with_lowercase(client):
    client.post(
        "/api/auth/register", json={"username": "alice", "password": "password123"}
    )
    resp = client.post(
        "/api/auth/register", json={"username": "ALICE", "password": "password456"}
    )
    assert resp.status_code == 409


def test_two_char_minimum_username_is_accepted(client):
    resp = client.post(
        "/api/auth/register", json={"username": "ab", "password": "password123"}
    )
    assert resp.status_code == 201


def test_exactly_8_char_password_is_accepted(client):
    resp = client.post(
        "/api/auth/register", json={"username": "alice", "password": "12345678"}
    )
    assert resp.status_code == 201


def test_7_char_password_is_rejected(client):
    resp = client.post(
        "/api/auth/register", json={"username": "alice", "password": "1234567"}
    )
    assert resp.status_code == 400


# ── Projection point count ────────────────────────────────────────────────────


def test_projection_point_count_for_all_supported_periods(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "S", "type": "savings", "interest_rate": 3.0}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    for months in (12, 24, 60):
        data = alice.get(f"/api/projections?months={months}").json()
        assert len(data[0]["points"]) == months + 1, (
            f"Expected {months + 1} points for months={months}"
        )


# ── Multiple accounts in dashboard aggregations ───────────────────────────────


def test_history_all_includes_all_accounts_with_entries(alice):
    for name, balance in (("A1", 100.0), ("A2", 200.0), ("A3", 300.0)):
        aid = alice.post(
            "/api/accounts", json={"name": name, "type": "current"}
        ).json()["id"]
        alice.post(f"/api/accounts/{aid}/balance", json={"balance": balance})

    data = alice.get("/api/history/all").json()
    names = {d["name"] for d in data}
    assert names == {"A1", "A2", "A3"}


def test_multiple_savings_accounts_each_appear_in_projections(alice):
    for name, rate in (("Saver A", 3.0), ("Saver B", 4.5)):
        aid = alice.post(
            "/api/accounts",
            json={"name": name, "type": "savings", "interest_rate": rate},
        ).json()["id"]
        alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})

    data = alice.get("/api/projections").json()
    names = {d["name"] for d in data}
    assert names == {"Saver A", "Saver B"}
