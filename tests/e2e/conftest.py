"""
Pytest fixtures for the Playwright end-to-end suite.

These tests run against a real Uvicorn server (not Starlette's TestClient) so
that the browser can load `/`, fetch `/static/*`, and exercise the same code
paths a real user does.

Key design choices:

* The server is **session-scoped** — booting Uvicorn for every test would push a
  10-test suite past a minute. State isolation between tests is achieved by
  registering a fresh user (random username) instead of sharing accounts.
* The DB is a temp file pointed at via the `FINDASH_DB` env var, which
  `constants.DB` reads at import time. Lives for the whole pytest session and
  is removed in finalisation.
* The port is picked dynamically (bind to :0, read back the assigned port) so
  the suite never collides with the dev server on :8080.
* `headed` and `slow_mo` can be toggled with `FINDASH_E2E_HEADED=1` and
  `FINDASH_E2E_SLOWMO=250` to debug a failing test visually.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest
import requests

REPO_ROOT = Path(__file__).resolve().parents[2]


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_http(url: str, timeout_s: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_s
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            r = requests.get(url, timeout=1.0)
            if r.status_code < 500:
                return
        except requests.RequestException as e:
            last_err = e
        time.sleep(0.1)
    raise RuntimeError(f"Server at {url} did not become ready: {last_err}")


@pytest.fixture(scope="session")
def live_server(tmp_path_factory):
    """Boot Uvicorn against a fresh temp DB; yield the base URL."""
    db_path = tmp_path_factory.mktemp("findash-e2e") / "e2e.db"
    port = _pick_free_port()
    base_url = f"http://127.0.0.1:{port}"

    env = os.environ.copy()
    env["FINDASH_DB"] = str(db_path)
    # Make sure the child process imports the repo's app, not a stray install.
    env["PYTHONPATH"] = str(REPO_ROOT) + os.pathsep + env.get("PYTHONPATH", "")

    venv_uvicorn = REPO_ROOT / "venv" / "bin" / "uvicorn"
    cmd = [
        str(venv_uvicorn) if venv_uvicorn.exists() else "uvicorn",
        "app:app",
        "--host", "127.0.0.1",
        "--port", str(port),
        "--log-level", "warning",
    ]

    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        _wait_for_http(f"{base_url}/login")
        yield base_url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args, live_server):
    """Default every context to base URL = our live server."""
    return {**browser_context_args, "base_url": live_server}


@pytest.fixture
def unique_user() -> dict[str, str]:
    """Random username/password pair so tests don't collide on the shared DB."""
    suffix = uuid.uuid4().hex[:10]
    return {"username": f"u_{suffix}", "password": "Passw0rd!demo"}


def _register_via_api(base_url: str, username: str, password: str) -> None:
    r = requests.post(
        f"{base_url}/api/auth/register",
        json={"username": username, "password": password},
        timeout=5,
    )
    if r.status_code not in (201, 200):
        raise RuntimeError(f"register failed: {r.status_code} {r.text}")


@pytest.fixture
def registered_user(live_server, unique_user) -> dict[str, str]:
    """Same as unique_user, but already registered with the backend."""
    _register_via_api(live_server, unique_user["username"], unique_user["password"])
    return unique_user


@pytest.fixture
def signed_in_page(page, live_server, registered_user):
    """A Playwright page that has just signed in and is sitting on /."""
    page.goto("/login")
    page.locator("#login-username").fill(registered_user["username"])
    page.locator("#login-password").fill(registered_user["password"])
    page.locator("#login-btn").click()
    # Dashboard renders the username in the header once /api/auth/me resolves —
    # that's a reliable "page is interactive" signal.
    page.wait_for_url("**/")
    page.locator("#header-username").wait_for(state="visible")
    return page


def pytest_collection_modifyitems(config, items):
    """Mark every test in this directory as `e2e` so the suite is opt-in."""
    e2e_root = Path(__file__).parent.resolve()
    for item in items:
        if e2e_root in Path(item.fspath).resolve().parents or Path(item.fspath).resolve() == e2e_root:
            item.add_marker(pytest.mark.e2e)


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    """Honour FINDASH_E2E_HEADED / FINDASH_E2E_SLOWMO env vars for debugging."""
    args = dict(browser_type_launch_args)
    if os.environ.get("FINDASH_E2E_HEADED", "").lower() in ("1", "true", "yes"):
        args["headless"] = False
    slowmo = os.environ.get("FINDASH_E2E_SLOWMO")
    if slowmo:
        args["slow_mo"] = int(slowmo)
    return args
