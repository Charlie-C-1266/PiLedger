"""
Tests for custom transaction category endpoints:
  GET    /api/categories
  POST   /api/categories
  DELETE /api/categories/{cid}
"""

from constants import DEFAULT_CATEGORIES, MAX_CUSTOM_CATEGORIES


# ── Auth gates ───────────────────────────────────────────────────────────────


def test_list_categories_requires_auth(client):
    assert client.get("/api/categories").status_code == 401


def test_create_category_requires_auth(client):
    assert client.post("/api/categories", json={"name": "Pets"}).status_code == 401


def test_delete_category_requires_auth(client):
    assert client.delete("/api/categories/1").status_code == 401


# ── List ─────────────────────────────────────────────────────────────────────


def test_list_returns_defaults_for_new_user(alice):
    r = alice.get("/api/categories")
    assert r.status_code == 200
    body = r.json()
    assert body["defaults"] == DEFAULT_CATEGORIES
    assert body["custom"] == []


def test_list_includes_custom_categories(alice):
    alice.post("/api/categories", json={"name": "Pets"})
    alice.post("/api/categories", json={"name": "Birthdays"})
    body = alice.get("/api/categories").json()
    names = [c["name"] for c in body["custom"]]
    assert "Pets" in names
    assert "Birthdays" in names


# ── Create ───────────────────────────────────────────────────────────────────


def test_create_returns_201_and_correct_fields(alice):
    r = alice.post("/api/categories", json={"name": "Hobbies"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Hobbies"
    assert "id" in body


def test_create_strips_whitespace(alice):
    r = alice.post("/api/categories", json={"name": "  Pets  "})
    assert r.status_code == 201
    assert r.json()["name"] == "Pets"


def test_create_rejects_blank_name(alice):
    assert alice.post("/api/categories", json={"name": ""}).status_code == 400


def test_create_rejects_whitespace_only_name(alice):
    assert alice.post("/api/categories", json={"name": "   "}).status_code == 400


def test_create_rejects_name_over_100_chars(alice):
    assert alice.post("/api/categories", json={"name": "x" * 101}).status_code == 400


def test_create_rejects_duplicate_name(alice):
    alice.post("/api/categories", json={"name": "Pets"})
    r = alice.post("/api/categories", json={"name": "Pets"})
    assert r.status_code == 409


def test_create_rejects_extra_fields(alice):
    r = alice.post("/api/categories", json={"name": "Pets", "colour": "red"})
    assert r.status_code == 400


def test_create_enforces_per_user_limit(alice):
    for i in range(MAX_CUSTOM_CATEGORIES):
        r = alice.post("/api/categories", json={"name": f"Cat{i}"})
        assert r.status_code == 201
    r = alice.post("/api/categories", json={"name": "TooMany"})
    assert r.status_code == 422


# ── User isolation ───────────────────────────────────────────────────────────


def test_user_cannot_see_others_custom_categories(alice, bob):
    alice.post("/api/categories", json={"name": "Alice's Category"})
    body = bob.get("/api/categories").json()
    assert all(c["name"] != "Alice's Category" for c in body["custom"])


def test_duplicate_name_allowed_across_users(alice, bob):
    alice.post("/api/categories", json={"name": "Pets"})
    r = bob.post("/api/categories", json={"name": "Pets"})
    assert r.status_code == 201


def test_user_cannot_delete_others_category(alice, bob):
    cat = alice.post("/api/categories", json={"name": "Pets"}).json()
    r = bob.delete(f"/api/categories/{cat['id']}")
    assert r.status_code == 404
    assert len(alice.get("/api/categories").json()["custom"]) == 1


# ── Delete ───────────────────────────────────────────────────────────────────


def test_delete_category(alice):
    cat = alice.post("/api/categories", json={"name": "Pets"}).json()
    r = alice.delete(f"/api/categories/{cat['id']}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert alice.get("/api/categories").json()["custom"] == []


def test_delete_nonexistent_returns_404(alice):
    assert alice.delete("/api/categories/99999").status_code == 404
