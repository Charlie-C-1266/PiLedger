"""
Tests for the security-headers middleware.

The middleware should attach a consistent set of defensive headers to every
response, regardless of route, authentication state, or status code. These
tests pin the exact header values so that any silent loosening of the CSP
or related policies shows up as a test failure rather than slipping past
review.
"""

import pytest

EXPECTED_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
}


def _assert_default_headers(response):
    for name, value in EXPECTED_HEADERS.items():
        assert response.headers.get(name) == value, (
            f"{name} mismatch: got {response.headers.get(name)!r}"
        )


def test_headers_on_login_page(client):
    resp = client.get("/login")
    assert resp.status_code == 200
    _assert_default_headers(resp)


def test_headers_on_root_redirect(client):
    # Unauthenticated GET / redirects to /login; the middleware must still run.
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 302
    _assert_default_headers(resp)


def test_headers_on_api_401(client):
    # An unauthenticated API call returns 401 — middleware must still apply.
    resp = client.get("/api/summary")
    assert resp.status_code == 401
    _assert_default_headers(resp)


def test_headers_on_authed_summary(alice):
    resp = alice.get("/api/summary")
    assert resp.status_code == 200
    _assert_default_headers(resp)


def test_headers_on_static_asset(client):
    resp = client.get("/static/style.css")
    assert resp.status_code == 200
    _assert_default_headers(resp)


def test_csp_blocks_inline_scripts_and_cdns(client):
    resp = client.get("/login")
    csp = resp.headers.get("Content-Security-Policy", "")
    # script-src must lock down to self only — no 'unsafe-inline', no CDN hosts.
    assert "script-src 'self'" in csp
    assert "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]
    assert "cdn.jsdelivr.net" not in csp
    assert "fonts.googleapis.com" not in csp


@pytest.mark.parametrize(
    "directive",
    [
        "default-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
    ],
)
def test_csp_directive_present(client, directive):
    resp = client.get("/login")
    csp = resp.headers["Content-Security-Policy"]
    assert directive in csp, f"missing CSP directive: {directive!r}"
