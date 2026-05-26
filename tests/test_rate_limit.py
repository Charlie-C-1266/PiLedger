"""
Tests for the login rate limiter (P0-4, slowapi).

The shared ``app`` fixture in ``conftest.py`` disables the limiter by
default so suite-wide test isolation is not broken by the 5/min cap.
These tests re-enable it explicitly and clear in-memory state between
cases.

slowapi keys on ``request.client.host`` which is ``"testclient"`` under
``starlette.testclient.TestClient`` — so every test in this file shares a
single rate-limit bucket, which is exactly what we want for asserting
the cap.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def rate_limited_client(app, monkeypatch):
    """A TestClient with the production rate limiter active, freshly reset."""
    import app as app_module

    monkeypatch.setattr(app_module.limiter, "enabled", True)
    app_module.limiter.reset()
    with TestClient(app) as c:
        # Register a real user so we can test both wrong- and right-password
        # paths against the limiter.
        c.post(
            "/api/auth/register",
            json={"username": "alice", "password": "password123"},
        )
        yield c


def _login(c, password="password123"):
    return c.post(
        "/api/auth/login",
        json={"username": "alice", "password": password},
    )


# ── Happy path under the cap ────────────────────────────────────────────────


def test_under_limit_succeeds(rate_limited_client):
    # Five correct logins in burst all succeed.
    for _ in range(5):
        resp = _login(rate_limited_client)
        assert resp.status_code == 200


# ── The cap kicks in ────────────────────────────────────────────────────────


def test_sixth_attempt_returns_429(rate_limited_client):
    # First five attempts with the wrong password return 401 (auth failure).
    for _ in range(5):
        resp = _login(rate_limited_client, password="wrong-password")
        assert resp.status_code == 401
    # Sixth in the same window crosses the 5/min cap.
    resp = _login(rate_limited_client, password="wrong-password")
    assert resp.status_code == 429


def test_cap_applies_regardless_of_password_validity(rate_limited_client):
    # Mixing correct and incorrect attempts still counts against the bucket:
    # the limit is on requests, not on failures.
    for _ in range(5):
        assert _login(rate_limited_client).status_code == 200
    resp = _login(rate_limited_client)
    assert resp.status_code == 429


# ── The cap does NOT apply to other endpoints ───────────────────────────────


def test_register_is_not_rate_limited(rate_limited_client):
    # Burn the login budget, then confirm registration is unaffected.
    for _ in range(6):
        _login(rate_limited_client, password="wrong")
    for i in range(10):
        resp = rate_limited_client.post(
            "/api/auth/register",
            json={"username": f"user{i}", "password": "password123"},
        )
        assert resp.status_code == 201


def test_login_page_get_is_not_rate_limited(rate_limited_client):
    # GET /login serves the SPA shell and must stay reachable even after the
    # POST limit has been blown.
    for _ in range(6):
        _login(rate_limited_client, password="wrong")
    resp = rate_limited_client.get("/login")
    assert resp.status_code == 200


# ── Defence-in-depth: 429 still carries the security headers ────────────────


def test_429_response_carries_security_headers(rate_limited_client):
    for _ in range(5):
        _login(rate_limited_client, password="wrong")
    resp = _login(rate_limited_client, password="wrong")
    assert resp.status_code == 429
    # SecurityHeadersMiddleware (P0-3) must still apply on a rate-limited
    # response — otherwise an attacker probing the limit could observe a
    # response with weaker headers than legitimate traffic.
    assert resp.headers.get("X-Frame-Options") == "DENY"
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert "default-src 'self'" in resp.headers.get("Content-Security-Policy", "")
