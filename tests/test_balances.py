"""
Tests for recording balance snapshots and retrieving balance history.
"""


# ── Recording ─────────────────────────────────────────────────────────────────

def test_record_balance_returns_ok(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    resp = alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1500.00})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_recorded_balance_appears_in_account_list(alice):
    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 2500.00})
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert acc["current_balance"] == 2500.00
    assert acc["last_updated"] is not None


def test_latest_entry_is_shown_in_account_list(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    for amount in (1000.00, 1500.00, 2000.00):
        alice.post(f"/api/accounts/{aid}/balance", json={"balance": amount})
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert acc["current_balance"] == 2000.00


def test_account_with_no_balance_shows_null(alice):
    aid = alice.post("/api/accounts", json={"name": "Empty", "type": "current"}).json()["id"]
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert acc["current_balance"] is None
    assert acc["last_updated"] is None


def test_record_balance_on_nonexistent_account_returns_404(alice):
    assert alice.post("/api/accounts/99999/balance", json={"balance": 100.0}).status_code == 404


def test_record_balance_requires_auth(client, alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    assert client.post(f"/api/accounts/{aid}/balance", json={"balance": 100.0}).status_code == 401


def test_user_cannot_record_balance_on_another_users_account(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()["id"]
    assert bob.post(f"/api/accounts/{aid}/balance", json={"balance": 9999.00}).status_code == 404


# ── History retrieval ─────────────────────────────────────────────────────────

def test_history_returns_entries_in_chronological_order(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.00})
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1500.00})
    entries = alice.get(f"/api/accounts/{aid}/history").json()
    assert len(entries) == 2
    assert entries[0]["balance"] == 1000.00
    assert entries[1]["balance"] == 1500.00


def test_history_includes_notes(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.00, "notes": "monthly check"})
    entries = alice.get(f"/api/accounts/{aid}/history").json()
    assert entries[0]["notes"] == "monthly check"


def test_history_is_empty_for_new_account(alice):
    aid = alice.post("/api/accounts", json={"name": "Empty", "type": "current"}).json()["id"]
    assert alice.get(f"/api/accounts/{aid}/history").json() == []


def test_history_on_nonexistent_account_returns_404(alice):
    assert alice.get("/api/accounts/99999/history").status_code == 404


def test_history_requires_auth(client, alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    assert client.get(f"/api/accounts/{aid}/history").status_code == 401


def test_user_cannot_read_another_users_history(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()["id"]
    assert bob.get(f"/api/accounts/{aid}/history").status_code == 404


def test_history_days_filter_excludes_old_entries(alice):
    """Entries with a far-past recorded_at should be excluded by the days filter."""
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]
    # Back-date one entry to a point well outside any reasonable window
    alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.00,
        "recorded_at": "2000-01-01T00:00:00Z",
    })
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 200.00})

    entries = alice.get(f"/api/accounts/{aid}/history?days=30").json()
    assert len(entries) == 1
    assert entries[0]["balance"] == 200.00


# ── Cascade deletion ──────────────────────────────────────────────────────────

def test_deleting_account_removes_its_history(alice):
    aid = alice.post("/api/accounts", json={"name": "Temp", "type": "current"}).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 500.00})
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 600.00})
    alice.delete(f"/api/accounts/{aid}")
    # Account gone → attempting to read its history returns 404
    assert alice.get(f"/api/accounts/{aid}/history").status_code == 404
