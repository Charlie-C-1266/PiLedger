"""
Tests for RequestIdMiddleware (src/security.py).

Every response should carry a unique X-Request-Id, regardless of route,
auth state, or status code — mirrors the pattern in test_security_headers.py.
"""


def test_request_id_present_on_response(client):
    resp = client.get("/login")
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-Id")


def test_request_id_present_on_api_401(client):
    resp = client.get("/api/summary")
    assert resp.status_code == 401
    assert resp.headers.get("X-Request-Id")


def test_request_id_differs_between_requests(client):
    first = client.get("/login").headers["X-Request-Id"]
    second = client.get("/login").headers["X-Request-Id"]
    assert first != second


def test_request_id_not_taken_from_client_header(client):
    # The server must never trust a client-supplied request ID — it always
    # generates its own, since there's no trusted reverse proxy in front of
    # the test client that could have set/stripped one.
    resp = client.get("/login", headers={"X-Request-Id": "attacker-supplied"})
    assert resp.headers["X-Request-Id"] != "attacker-supplied"
