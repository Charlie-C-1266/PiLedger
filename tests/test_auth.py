"""
Tests for the authentication system: registration, login, logout,
session validation, and access control on the root route.
"""


# ── Registration ───────────────────────────────────────────────────────────────

def test_register_returns_id_and_username(client):
    resp = client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["username"] == "alice"
    assert "id" in body


def test_register_does_not_expose_password(client):
    resp = client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    body = resp.json()
    assert "password" not in body
    assert "password_hash" not in body


def test_register_trims_whitespace_from_username(client):
    resp = client.post("/api/auth/register", json={"username": "  alice  ", "password": "password123"})
    assert resp.status_code == 201
    assert resp.json()["username"] == "alice"


def test_register_rejects_short_username(client):
    resp = client.post("/api/auth/register", json={"username": "a", "password": "password123"})
    assert resp.status_code == 400


def test_register_rejects_short_password(client):
    resp = client.post("/api/auth/register", json={"username": "alice", "password": "short"})
    assert resp.status_code == 400


def test_register_rejects_duplicate_username(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    resp = client.post("/api/auth/register", json={"username": "alice", "password": "different1"})
    assert resp.status_code == 409


def test_register_username_comparison_is_case_insensitive(client):
    client.post("/api/auth/register", json={"username": "Alice", "password": "password123"})
    resp = client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    assert resp.status_code == 409


# ── Login ──────────────────────────────────────────────────────────────────────

def test_login_success(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "password123"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"


def test_login_sets_session_cookie(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "password123"})
    assert "findash_session" in resp.cookies


def test_login_rejects_wrong_password(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "wrongpass1"})
    assert resp.status_code == 401


def test_login_rejects_unknown_user(client):
    resp = client.post("/api/auth/login", json={"username": "nobody", "password": "password123"})
    assert resp.status_code == 401


def test_login_username_match_is_case_insensitive(client):
    client.post("/api/auth/register", json={"username": "Alice", "password": "password123"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "password123"})
    assert resp.status_code == 200


# ── Session / me ───────────────────────────────────────────────────────────────

def test_me_returns_current_user(alice):
    resp = alice.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"


def test_me_requires_authentication(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_rejects_garbage_token(client):
    client.cookies.set("findash_session", "notarealtoken")
    assert client.get("/api/auth/me").status_code == 401


# ── Logout ─────────────────────────────────────────────────────────────────────

def test_logout_invalidates_session(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    client.post("/api/auth/login",    json={"username": "alice", "password": "password123"})
    assert client.get("/api/auth/me").status_code == 200

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401


def test_logout_without_session_is_safe(client):
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 200


def test_reused_token_after_logout_is_rejected(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    login_resp = client.post("/api/auth/login", json={"username": "alice", "password": "password123"})
    token = login_resp.cookies["findash_session"]

    client.post("/api/auth/logout")

    # Re-inject the old token to simulate a client that cached it or a replay attack.
    client.cookies.set("findash_session", token)
    assert client.get("/api/auth/me").status_code == 401


# ── Route access control ───────────────────────────────────────────────────────

def test_root_redirects_unauthenticated_to_login(client):
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 302
    assert "/login" in resp.headers["location"]


def test_root_serves_dashboard_when_authenticated(alice):
    resp = alice.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]


def test_login_page_is_public(client):
    resp = client.get("/login")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
