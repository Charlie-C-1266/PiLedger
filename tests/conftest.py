"""
Shared pytest fixtures.

Each test receives a completely isolated SQLite database via the `app` fixture,
which monkeypatches `app.DB` to a fresh temporary file and re-runs `app.init()`.
Because `app` is function-scoped (the default), no state leaks between tests.

`alice` and `bob` both depend on the same `app` fixture instance within a single
test, so they share one database — which is required for isolation tests where
one user should not be able to see another's data.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def app(tmp_path, monkeypatch):
    """Return the FastAPI app pointed at a fresh, empty test database."""
    import app as app_module

    monkeypatch.setattr(app_module, "DB", str(tmp_path / "test.db"))
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
        c.post("/api/auth/register", json={"username": "alice", "password": "password123"})
        c.post("/api/auth/login",    json={"username": "alice", "password": "password123"})
        yield c


@pytest.fixture
def bob(app):
    """HTTP client authenticated as user 'bob' (shares the same DB as alice)."""
    with TestClient(app) as c:
        c.post("/api/auth/register", json={"username": "bob", "password": "password123"})
        c.post("/api/auth/login",    json={"username": "bob", "password": "password123"})
        yield c
