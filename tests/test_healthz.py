"""
Tests for `GET /healthz` — the liveness + version probe.

The endpoint is what the Docker / Compose healthchecks and any external
uptime monitor (Uptime Kuma, Healthchecks.io, kube liveness probes) hit.
The contract is small but load-bearing: HTTP 200, an `ok: true` field
that scrapers can check independently of the status code, the running
version string, and a monotonic uptime counter that never goes
backwards.
"""

import time

from constants import VERSION


def test_healthz_unauthenticated_returns_200(client):
    """No session cookie required — uptime monitors must be able to poll
    without holding a session. A 401 here would break every external probe."""
    r = client.get("/healthz")
    assert r.status_code == 200


def test_healthz_response_shape(client):
    body = client.get("/healthz").json()
    assert body["ok"] is True
    assert body["version"] == VERSION
    assert isinstance(body["uptime_s"], int)
    assert body["uptime_s"] >= 0


def test_healthz_uptime_advances(client):
    """Two probes a moment apart must report non-decreasing uptime. Catches
    accidental use of a wall-clock timer that could move backwards under NTP
    adjustment, or a bug that recomputes the boot time on every request."""
    first = client.get("/healthz").json()["uptime_s"]
    time.sleep(1.05)
    second = client.get("/healthz").json()["uptime_s"]
    assert second >= first
    # The probes were >1s apart, so at least one tick must be observable.
    assert second - first >= 1


def test_healthz_not_in_openapi_schema(alice):
    """Ops endpoints are documented in the README rather than the API spec,
    and crowding the OpenAPI doc with internals would obscure the user-facing
    routes. Pinned via `include_in_schema=False` on the route decorator."""
    schema = alice.get("/api/openapi.json").json()
    assert "/healthz" not in schema.get("paths", {})


def test_healthz_carries_security_headers(client):
    """The defensive headers middleware (P0-3) must wrap /healthz too — the
    one-year HSTS line in particular only takes effect if every response a
    browser ever sees from this origin carries it."""
    headers = {k.lower(): v for k, v in client.get("/healthz").headers.items()}
    assert "strict-transport-security" in headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
