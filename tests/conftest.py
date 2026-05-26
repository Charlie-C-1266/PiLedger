"""
Shared pytest fixtures.

Each test receives a completely isolated SQLite database via the `app` fixture,
which monkeypatches `constants.DB` to a fresh temporary file and re-runs
``init()``. The DB path is read from ``constants.DB`` at call time inside
``db.db()``, so patching the constant is enough to redirect every query.
Because `app` is function-scoped (the default), no state leaks between tests.

`alice` and `bob` both depend on the same `app` fixture instance within a single
test, so they share one database — which is required for isolation tests where
one user should not be able to see another's data.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def app(tmp_path, monkeypatch):
    """Return the FastAPI app pointed at a fresh, empty test database.

    The login rate limiter is disabled by default so the suite — including
    fixtures that log in repeatedly — does not trip the production 5/min
    cap. Tests that specifically exercise rate limiting re-enable it; see
    ``tests/test_rate_limit.py``.
    """
    import app as app_module
    import constants

    monkeypatch.setattr(constants, "DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(app_module.limiter, "enabled", False)
    app_module.init()
    return app_module.app


@pytest.fixture
def client(app):
    """Unauthenticated HTTP client."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def alice(app):
    """HTTP client authenticated as user 'alice'."""
    with TestClient(app) as c:
        c.post(
            "/api/auth/register", json={"username": "alice", "password": "password123"}
        )
        c.post("/api/auth/login", json={"username": "alice", "password": "password123"})
        yield c


@pytest.fixture
def bob(app):
    """HTTP client authenticated as user 'bob' (shares the same DB as alice)."""
    with TestClient(app) as c:
        c.post(
            "/api/auth/register", json={"username": "bob", "password": "password123"}
        )
        c.post("/api/auth/login", json={"username": "bob", "password": "password123"})
        yield c
