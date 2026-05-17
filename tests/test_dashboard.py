"""
Tests for the three dashboard aggregation endpoints:
  GET /api/summary
  GET /api/history/all
  GET /api/projections
"""
import math


# ── Summary ───────────────────────────────────────────────────────────────────

def test_summary_empty(alice):
    body = alice.get("/api/summary").json()
    assert body == {"total": 0.0, "total_current": 0.0, "total_savings": 0.0, "account_count": 0}


def test_summary_requires_auth(client):
    assert client.get("/api/summary").status_code == 401


def test_summary_current_accounts(alice):
    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    body = alice.get("/api/summary").json()
    assert body["total_current"] == 1000.0
    assert body["total_savings"] == 0.0
    assert body["total"] == 1000.0
    assert body["account_count"] == 1


def test_summary_savings_accounts(alice):
    aid = alice.post("/api/accounts", json={"name": "Marcus", "type": "savings", "interest_rate": 4.0}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 5000.0})
    body = alice.get("/api/summary").json()
    assert body["total_savings"] == 5000.0
    assert body["total_current"] == 0.0


def test_summary_mixed_accounts(alice):
    c = alice.post("/api/accounts", json={"name": "Current", "type": "current"}).json()["id"]
    s = alice.post("/api/accounts", json={"name": "Savings", "type": "savings"}).json()["id"]
    alice.post(f"/api/accounts/{c}/balance", json={"balance": 1500.0})
    alice.post(f"/api/accounts/{s}/balance", json={"balance": 3000.0})
    body = alice.get("/api/summary").json()
    assert body["total"] == 4500.0
    assert body["total_current"] == 1500.0
    assert body["total_savings"] == 3000.0
    assert body["account_count"] == 2


def test_summary_account_without_balance_contributes_zero_to_total(alice):
    alice.post("/api/accounts", json={"name": "NoBalance", "type": "current"})
    body = alice.get("/api/summary").json()
    assert body["total"] == 0.0
    assert body["account_count"] == 1  # account is counted even without a balance entry


def test_summary_uses_latest_balance_only(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 100.0})
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 200.0})
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 300.0})
    body = alice.get("/api/summary").json()
    assert body["total_current"] == 300.0  # not 600 (sum) or 100 (first)


def test_summary_user_isolation(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 10_000.0})
    body = bob.get("/api/summary").json()
    assert body["total"] == 0.0
    assert body["account_count"] == 0


# ── History / all ─────────────────────────────────────────────────────────────

def test_history_all_empty(alice):
    assert alice.get("/api/history/all").json() == []


def test_history_all_requires_auth(client):
    assert client.get("/api/history/all").status_code == 401


def test_history_all_returns_accounts_that_have_entries(alice):
    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current", "color": "#f97316"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    data = alice.get("/api/history/all").json()
    assert len(data) == 1
    assert data[0]["name"] == "Monzo"
    assert data[0]["history"][0]["balance"] == 1000.0


def test_history_all_excludes_accounts_without_entries(alice):
    alice.post("/api/accounts", json={"name": "NoBalance", "type": "current"})
    assert alice.get("/api/history/all").json() == []


def test_history_all_days_filter_excludes_old_entries(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "2000-01-01T00:00:00Z",
    })
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 200.0})

    data = alice.get("/api/history/all?days=30").json()
    # Account still appears (has a recent entry) but only the recent entry is included
    assert len(data) == 1
    assert len(data[0]["history"]) == 1
    assert data[0]["history"][0]["balance"] == 200.0


def test_history_all_account_absent_when_all_entries_are_old(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "2000-01-01T00:00:00Z",
    })
    data = alice.get("/api/history/all?days=30").json()
    assert data == []


def test_history_all_user_isolation(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    assert bob.get("/api/history/all").json() == []


# ── Projections ───────────────────────────────────────────────────────────────

def test_projections_empty_when_no_savings_accounts(alice):
    alice.post("/api/accounts", json={"name": "Current", "type": "current"})
    assert alice.get("/api/projections").json() == []


def test_projections_requires_auth(client):
    assert client.get("/api/projections").status_code == 401


def test_projections_returns_correct_structure(alice):
    aid = alice.post("/api/accounts", json={"name": "Marcus", "type": "savings", "interest_rate": 4.1}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 8000.0})
    proj = alice.get("/api/projections?months=12").json()[0]
    assert proj["name"] == "Marcus"
    assert proj["initial_balance"] == 8000.0
    assert proj["interest_rate"] == 4.1
    assert "1yr" in proj and "2yr" in proj and "5yr" in proj
    assert "points" in proj


def test_projections_1yr_compound_interest_calculation(alice):
    aid = alice.post("/api/accounts", json={"name": "Saver", "type": "savings", "interest_rate": 4.1}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 8000.0})
    proj = alice.get("/api/projections").json()[0]

    expected = round(8000.0 * math.pow(1 + (4.1 / 100) / 12, 12), 2)
    assert proj["1yr"] == expected


def test_projections_5yr_compound_interest_calculation(alice):
    aid = alice.post("/api/accounts", json={"name": "Saver", "type": "savings", "interest_rate": 3.5}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 10_000.0})
    proj = alice.get("/api/projections").json()[0]

    monthly_rate = (3.5 / 100) / 12
    expected = round(10_000.0 * math.pow(1 + monthly_rate, 60), 2)
    assert proj["5yr"] == expected


def test_projections_points_length_matches_months_parameter(alice):
    aid = alice.post("/api/accounts", json={"name": "S", "type": "savings", "interest_rate": 5.0}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    for months in (12, 24, 60):
        data = alice.get(f"/api/projections?months={months}").json()
        assert len(data[0]["points"]) == months + 1  # month 0 through month N


def test_projections_first_point_equals_current_balance(alice):
    aid = alice.post("/api/accounts", json={"name": "S", "type": "savings", "interest_rate": 5.0}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 2500.0})
    proj = alice.get("/api/projections").json()[0]
    assert proj["points"][0]["balance"] == 2500.0


def test_projections_zero_interest_stays_flat(alice):
    aid = alice.post("/api/accounts", json={"name": "Flat Saver", "type": "savings", "interest_rate": 0.0}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 5000.0})
    proj = alice.get("/api/projections?months=24").json()[0]
    assert proj["1yr"] == 5000.0
    assert proj["2yr"] == 5000.0
    assert all(p["balance"] == 5000.0 for p in proj["points"])


def test_projections_no_balance_recorded_uses_zero(alice):
    alice.post("/api/accounts", json={"name": "Empty Saver", "type": "savings", "interest_rate": 5.0})
    proj = alice.get("/api/projections").json()[0]
    assert proj["initial_balance"] == 0.0
    assert proj["1yr"] == 0.0


def test_projections_user_isolation(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice Saver", "type": "savings", "interest_rate": 4.0}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 5000.0})
    assert bob.get("/api/projections").json() == []
