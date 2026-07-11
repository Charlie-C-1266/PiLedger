"""
Tests for personal access tokens: minting, listing, revocation, bearer-auth
resolution on protected routes, and the token-management routes' session-only
gate (a leaked bearer token must not be able to mint/list/revoke tokens).
"""


# ── Minting / listing / revoking (session-only) ─────────────────────────────


def test_create_token_returns_raw_value_once(alice):
    r = alice.post("/api/tokens", json={"name": "claude-mcp"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "claude-mcp"
    assert body["token"].startswith("pil_")
    assert body["last_used_at"] is None


def test_list_tokens_never_exposes_raw_value(alice):
    alice.post("/api/tokens", json={"name": "claude-mcp"})
    r = alice.get("/api/tokens")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["name"] == "claude-mcp"
    assert "token" not in body[0]
    assert "token_hash" not in body[0]


def test_revoke_token_removes_it_from_list(alice):
    created = alice.post("/api/tokens", json={"name": "claude-mcp"}).json()
    r = alice.delete(f"/api/tokens/{created['id']}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert alice.get("/api/tokens").json() == []


def test_revoke_unknown_token_is_404(alice):
    assert alice.delete("/api/tokens/999999").status_code == 404


def test_cannot_revoke_another_users_token(alice, bob):
    created = alice.post("/api/tokens", json={"name": "claude-mcp"}).json()
    assert bob.delete(f"/api/tokens/{created['id']}").status_code == 404
    # Alice's token survives bob's failed attempt.
    assert len(alice.get("/api/tokens").json()) == 1


def test_token_management_requires_session_not_bearer(alice, client):
    """A bearer token must not be able to mint, list, or revoke tokens —
    only the session-cookie path (`require_session_auth`) may."""
    raw = alice.post("/api/tokens", json={"name": "claude-mcp"}).json()["token"]
    headers = {"Authorization": f"Bearer {raw}"}
    assert (
        client.post(
            "/api/tokens", json={"name": "another"}, headers=headers
        ).status_code
        == 401
    )
    assert client.get("/api/tokens", headers=headers).status_code == 401
    assert client.delete("/api/tokens/1", headers=headers).status_code == 401


def test_create_token_requires_auth(client):
    assert client.post("/api/tokens", json={"name": "x"}).status_code == 401


def test_create_token_rejects_unknown_fields(alice):
    r = alice.post("/api/tokens", json={"name": "x", "wat": 1})
    assert r.status_code == 400


# ── Bearer auth on protected routes ──────────────────────────────────────────


def test_bearer_token_authenticates_protected_route(alice, client):
    raw = alice.post("/api/tokens", json={"name": "claude-mcp"}).json()["token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200
    assert r.json()["username"] == "alice"


def test_bearer_token_can_write(alice, client):
    raw = alice.post("/api/tokens", json={"name": "claude-mcp"}).json()["token"]
    headers = {"Authorization": f"Bearer {raw}"}
    r = client.post(
        "/api/accounts",
        json={"name": "Current", "type": "current", "currency": "GBP"},
        headers=headers,
    )
    assert r.status_code == 201
    # Confirm it actually landed under alice's account, not a phantom user.
    assert alice.get("/api/accounts").json()[0]["name"] == "Current"


def test_revoked_token_returns_401(alice, client):
    created = alice.post("/api/tokens", json={"name": "claude-mcp"}).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    alice.delete(f"/api/tokens/{created['id']}")
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_garbage_bearer_token_returns_401(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer notarealtoken"})
    assert r.status_code == 401


def test_malformed_authorization_header_falls_through_to_401(client):
    r = client.get("/api/auth/me", headers={"Authorization": "notbearer x"})
    assert r.status_code == 401


def test_bearer_token_cannot_read_another_users_data(alice, bob, client):
    alice.post(
        "/api/accounts",
        json={"name": "Alice's account", "type": "current", "currency": "GBP"},
    )
    bob_raw = bob.post("/api/tokens", json={"name": "bob-token"}).json()["token"]
    r = client.get("/api/accounts", headers={"Authorization": f"Bearer {bob_raw}"})
    assert r.status_code == 200
    assert r.json() == []


def test_session_cookie_still_works_alongside_token_auth(alice):
    """Adding the bearer path must not break the existing cookie path."""
    assert alice.get("/api/auth/me").status_code == 200


# ── Export exclusion ─────────────────────────────────────────────────────────


def test_export_excludes_api_tokens(alice):
    alice.post("/api/tokens", json={"name": "claude-mcp"})
    body = alice.get("/api/export").json()
    assert "api_tokens" not in body
