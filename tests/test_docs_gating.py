"""
Tests for the auth-gated Swagger UI / ReDoc / OpenAPI JSON routes (P0-10).

FastAPI's default `/docs`, `/redoc`, and `/openapi.json` are disabled in
the app constructor; this module pins the replacement behaviour:

* `/docs` and `/redoc` redirect unauthenticated browsers to `/login`
  (mirrors `GET /` so a self-hoster following a bookmark sees a familiar
  login page rather than a JSON error blob).
* `/api/openapi.json` is a JSON API endpoint, so it 401s without a
  session.
* All three render normally once authenticated.

Without these tests the FastAPI defaults could be silently re-enabled by
a constructor change and an unauthenticated scanner could fingerprint
the entire API.
"""


# ── Default FastAPI mounts must NOT be reachable ─────────────────────────────


def test_root_openapi_json_disabled(client):
    """The FastAPI default `/openapi.json` is disabled — the replacement
    lives under `/api/openapi.json` and is auth-gated. A 404 here is the
    proof that an unauthenticated scanner cannot grab the spec from the
    well-known location."""
    assert client.get("/openapi.json").status_code == 404


# ── /docs gating ─────────────────────────────────────────────────────────────


def test_docs_redirects_to_login_when_unauthenticated(client):
    r = client.get("/docs", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/login"


def test_docs_renders_swagger_ui_for_authenticated_user(alice):
    r = alice.get("/docs")
    assert r.status_code == 200
    # FastAPI's `get_swagger_ui_html` returns a small HTML page that loads
    # Swagger UI from its bundled assets and points at the OpenAPI URL we
    # pass in — assert both markers are present so a future regression that
    # accidentally returns the ReDoc page or a 200 empty body is caught.
    body = r.text
    assert "swagger-ui" in body.lower()
    assert "/api/openapi.json" in body


# ── /redoc gating ────────────────────────────────────────────────────────────


def test_redoc_redirects_to_login_when_unauthenticated(client):
    r = client.get("/redoc", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/login"


def test_redoc_renders_for_authenticated_user(alice):
    r = alice.get("/redoc")
    assert r.status_code == 200
    body = r.text
    assert "redoc" in body.lower()
    assert "/api/openapi.json" in body


# ── /api/openapi.json gating ─────────────────────────────────────────────────


def test_openapi_json_requires_auth(client):
    """JSON API endpoint — 401, not redirect, matches the rest of /api/."""
    assert client.get("/api/openapi.json").status_code == 401


# ── /guide (public documentation viewer) ────────────────────────────────────


def test_guide_is_public(client):
    r = client.get("/guide")
    assert r.status_code == 200
    assert "Documentation" in r.text


def test_guide_serves_html(client):
    r = client.get("/guide")
    assert "text/html" in r.headers["content-type"]


# ── /api/docs/{slug} (public markdown endpoint) ─────────────────────────────


def test_api_docs_returns_markdown(client):
    r = client.get("/api/docs/getting-started")
    assert r.status_code == 200
    assert "# Getting Started" in r.text


def test_api_docs_404_for_unknown_slug(client):
    r = client.get("/api/docs/nonexistent")
    assert r.status_code == 404


def test_api_docs_rejects_path_traversal(client):
    r = client.get("/api/docs/..%2F..%2Fetc%2Fpasswd")
    assert r.status_code == 404


def test_api_docs_is_public(client):
    r = client.get("/api/docs/architecture")
    assert r.status_code == 200


def test_openapi_json_returns_spec_for_authenticated_user(alice):
    r = alice.get("/api/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    # Pin the OpenAPI top-level shape so a regression that returns an empty
    # dict or the FastAPI default landing page is caught immediately.
    assert "openapi" in spec
    assert spec["info"]["title"] == "PiLedger"
    # A representative real route must appear so the spec is actually
    # populated (rather than e.g. an empty `paths: {}` stub).
    assert "/api/auth/login" in spec["paths"]
    # Ops endpoints are excluded via `include_in_schema=False`.
    assert "/healthz" not in spec["paths"]
    assert "/docs" not in spec["paths"]
    assert "/api/openapi.json" not in spec["paths"]
