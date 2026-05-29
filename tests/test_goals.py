"""
Tests for goal CRUD endpoints:
  GET    /api/goals
  POST   /api/goals
  PUT    /api/goals/{gid}
  DELETE /api/goals/{gid}
"""

from constants import MAX_MONEY


def _goal(client, **kw):
    payload = {"name": "Holiday Fund", "target": 5000.0, **kw}
    return client.post("/api/goals", json=payload).json()


# ── Auth gates ───────────────────────────────────────────────────────────────


def test_list_goals_requires_auth(client):
    assert client.get("/api/goals").status_code == 401


def test_create_goal_requires_auth(client):
    assert client.post("/api/goals", json={}).status_code == 401


def test_update_goal_requires_auth(client):
    assert client.put("/api/goals/1", json={}).status_code == 401


def test_delete_goal_requires_auth(client):
    assert client.delete("/api/goals/1").status_code == 401


# ── Create + List ────────────────────────────────────────────────────────────


def test_create_returns_201_and_fields_correct(alice):
    r = alice.post(
        "/api/goals",
        json={
            "name": "Emergency Fund",
            "target": 10000.0,
            "saved": 2500.0,
            "monthly": 200.0,
            "color": "#FF5733",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Emergency Fund"
    assert body["target"] == 10000.0
    assert body["saved"] == 2500.0
    assert body["monthly"] == 200.0
    assert body["color"] == "#FF5733"
    assert "id" in body
    assert "created_at" in body


def test_create_with_defaults(alice):
    r = alice.post("/api/goals", json={"name": "Car", "target": 8000.0})
    assert r.status_code == 201
    body = r.json()
    assert body["saved"] == 0.0
    assert body["monthly"] == 0.0
    assert body["color"] == "#0F766E"


def test_created_goal_appears_in_list(alice):
    goal = _goal(alice, name="Visible Goal")
    items = alice.get("/api/goals").json()
    assert any(g["id"] == goal["id"] for g in items)


# ── User isolation ───────────────────────────────────────────────────────────


def test_user_cannot_see_others_goals(alice, bob):
    _goal(alice, name="Alice's Goal")
    assert bob.get("/api/goals").json() == []


def test_user_cannot_update_others_goal(alice, bob):
    goal = _goal(alice)
    r = bob.put(f"/api/goals/{goal['id']}", json={"name": "Hijacked"})
    assert r.status_code == 404
    refreshed = alice.get("/api/goals").json()
    assert refreshed[0]["name"] == "Holiday Fund"


def test_user_cannot_delete_others_goal(alice, bob):
    goal = _goal(alice)
    assert bob.delete(f"/api/goals/{goal['id']}").status_code == 404
    assert len(alice.get("/api/goals").json()) == 1


# ── Update ───────────────────────────────────────────────────────────────────


def test_patch_name_only(alice):
    goal = _goal(alice, name="Old Name", target=1000.0)
    r = alice.put(f"/api/goals/{goal['id']}", json={"name": "New Name"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "New Name"
    assert body["target"] == 1000.0


def test_patch_monthly_updates_contribution(alice):
    goal = _goal(alice, monthly=50.0)
    r = alice.put(f"/api/goals/{goal['id']}", json={"monthly": 150.0})
    assert r.json()["monthly"] == 150.0


def test_patch_saved_and_target(alice):
    goal = _goal(alice, target=5000.0, saved=0.0)
    r = alice.put(f"/api/goals/{goal['id']}", json={"target": 8000.0, "saved": 1200.0})
    body = r.json()
    assert body["target"] == 8000.0
    assert body["saved"] == 1200.0


def test_patch_empty_body_is_noop(alice):
    goal = _goal(alice)
    r = alice.put(f"/api/goals/{goal['id']}", json={})
    assert r.status_code == 200
    assert r.json()["id"] == goal["id"]


def test_update_nonexistent_returns_404(alice):
    assert alice.put("/api/goals/99999", json={"name": "X"}).status_code == 404


# ── Delete ───────────────────────────────────────────────────────────────────


def test_delete_goal(alice):
    goal = _goal(alice)
    r = alice.delete(f"/api/goals/{goal['id']}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert alice.get("/api/goals").json() == []


def test_delete_nonexistent_returns_404(alice):
    assert alice.delete("/api/goals/99999").status_code == 404


# ── Validation ───────────────────────────────────────────────────────────────


def test_create_rejects_blank_name(alice):
    r = alice.post("/api/goals", json={"name": "", "target": 1000.0})
    assert r.status_code == 400


def test_create_rejects_zero_target(alice):
    r = alice.post("/api/goals", json={"name": "X", "target": 0.0})
    assert r.status_code == 400


def test_create_rejects_negative_saved(alice):
    r = alice.post("/api/goals", json={"name": "X", "target": 1000.0, "saved": -1.0})
    assert r.status_code == 400


def test_create_rejects_amount_above_max_money(alice):
    r = alice.post("/api/goals", json={"name": "X", "target": MAX_MONEY + 1})
    assert r.status_code == 400


def test_create_rejects_bad_color(alice):
    r = alice.post("/api/goals", json={"name": "X", "target": 1000.0, "color": "red"})
    assert r.status_code == 400


def test_create_rejects_extra_field(alice):
    r = alice.post(
        "/api/goals",
        json={"name": "X", "target": 1000.0, "unknown_field": True},
    )
    assert r.status_code == 400


# ── Account linking (auto-tracked progress) ──────────────────────────────────


def _account(client, name="Savings", type_="savings", balance=None):
    aid = client.post("/api/accounts", json={"name": name, "type": type_}).json()["id"]
    if balance is not None:
        client.post(f"/api/accounts/{aid}/balance", json={"balance": balance})
    return aid


def test_linked_goal_saved_tracks_account_balance(alice):
    aid = _account(alice, balance=3000.0)
    g = _goal(alice, name="Emergency Fund", target=10000.0, account_id=aid)
    assert g["account_id"] == aid
    assert g["account_name"] == "Savings"
    assert g["saved"] == 3000.0


def test_linked_goal_saved_follows_balance_changes(alice):
    aid = _account(alice, balance=3000.0)
    g = _goal(alice, target=10000.0, account_id=aid)
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 4200.0})
    refreshed = next(x for x in alice.get("/api/goals").json() if x["id"] == g["id"])
    assert refreshed["saved"] == 4200.0


def test_create_goal_with_others_account_rejected(alice, bob):
    bob_aid = _account(bob, name="Bob Savings", balance=500.0)
    r = alice.post(
        "/api/goals",
        json={"name": "X", "target": 1000.0, "account_id": bob_aid},
    )
    assert r.status_code == 404


def test_update_goal_link_then_unlink(alice):
    aid = _account(alice, balance=3000.0)
    g = _goal(alice, target=10000.0, saved=150.0)  # unlinked, manual saved
    assert g["saved"] == 150.0 and g["account_id"] is None

    linked = alice.put(f"/api/goals/{g['id']}", json={"account_id": aid}).json()
    assert linked["account_id"] == aid
    assert linked["saved"] == 3000.0  # now tracks the account

    unlinked = alice.put(f"/api/goals/{g['id']}", json={"account_id": None}).json()
    assert unlinked["account_id"] is None
    assert unlinked["saved"] == 150.0  # reverts to stored manual value


def test_update_goal_to_others_account_rejected(alice, bob):
    bob_aid = _account(bob, name="Bob Savings", balance=500.0)
    g = _goal(alice, target=1000.0)
    r = alice.put(f"/api/goals/{g['id']}", json={"account_id": bob_aid})
    assert r.status_code == 404


def test_deleting_linked_account_unlinks_goal(alice):
    aid = _account(alice, balance=3000.0)
    g = _goal(alice, target=10000.0, saved=0.0, account_id=aid)
    assert g["saved"] == 3000.0

    assert alice.delete(f"/api/accounts/{aid}").status_code == 200

    # Goal survives, now unlinked, reporting its stored saved value.
    remaining = alice.get("/api/goals").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == g["id"]
    assert remaining[0]["account_id"] is None
    assert remaining[0]["saved"] == 0.0
