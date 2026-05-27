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
