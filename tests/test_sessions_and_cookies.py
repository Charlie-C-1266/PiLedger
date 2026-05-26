"""Defensive coverage for the session cookie and server-side session expiry.

Two concerns prior to this file were unguarded:

* The login Set-Cookie header sets ``HttpOnly``, ``SameSite=Lax``, a
  30-day ``Max-Age`` and (when ``COOKIE_SECURE`` is enabled) the
  ``Secure`` flag. A regression that drops ``HttpOnly`` would silently
  expose the session token to client-side JS — exactly the XSS-defence
  guarantee CSP-without-unsafe-inline is meant to back up.

* ``auth.session_uid`` filters by ``expires_at > now`` and
  ``auth.make_session`` opportunistically sweeps expired rows on every
  fresh login. Neither code path was exercised — the suite always uses
  freshly-issued tokens.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from constants import ISO_FMT, SESSION_DAYS


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _parse_set_cookie(raw: str) -> dict[str, str | bool]:
    """Parse one ``Set-Cookie`` header line into a lowercased attribute map.

    Boolean attributes (``HttpOnly``, ``Secure``) become ``True``; keyed
    attributes (``Max-Age=...``) keep their value as a string. The cookie's
    own name/value pair is stored under the special key ``_name``/``_value``
    so it can be inspected separately.
    """
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    name, _, value = parts[0].partition("=")
    out: dict[str, str | bool] = {"_name": name, "_value": value}
    for p in parts[1:]:
        if "=" in p:
            k, _, v = p.partition("=")
            out[k.lower()] = v
        else:
            out[p.lower()] = True
    return out


def _login_and_get_set_cookie(client: TestClient) -> dict[str, str | bool]:
    client.post(
        "/api/auth/register", json={"username": "alice", "password": "password123"}
    )
    resp = client.post(
        "/api/auth/login", json={"username": "alice", "password": "password123"}
    )
    assert resp.status_code == 200
    raws = resp.headers.get_list("set-cookie")
    matching = [r for r in raws if r.split("=", 1)[0] == "piledger_session"]
    assert len(matching) == 1, f"expected one piledger_session cookie, got {raws}"
    return _parse_set_cookie(matching[0])


# ─── Cookie attributes ────────────────────────────────────────────────────────


def test_login_cookie_is_httponly(client):
    """No client-side JS should be able to read the session token."""
    attrs = _login_and_get_set_cookie(client)
    assert attrs.get("httponly") is True


def test_login_cookie_samesite_is_lax(client):
    """SameSite=Lax blocks cross-site POSTs from carrying the session."""
    attrs = _login_and_get_set_cookie(client)
    assert str(attrs.get("samesite", "")).lower() == "lax"


def test_login_cookie_path_is_root(client):
    """Path=/ so /api/* and /static/* both see the session."""
    attrs = _login_and_get_set_cookie(client)
    assert attrs.get("path") == "/"


def test_login_cookie_max_age_matches_session_days(client):
    """Cookie expiry should agree with the server-side session row TTL."""
    attrs = _login_and_get_set_cookie(client)
    assert attrs.get("max-age") == str(SESSION_DAYS * 86400)


def test_login_cookie_secure_off_by_default(client):
    """COOKIE_SECURE defaults to False so the dev/LAN deployment over HTTP
    can still set the cookie. A regression that always emits Secure would
    silently break those deployments."""
    attrs = _login_and_get_set_cookie(client)
    assert attrs.get("secure", False) is False


def test_login_cookie_secure_on_when_cookie_secure_enabled(app, monkeypatch):
    """When COOKIE_SECURE=true is set in the environment, the cookie must
    carry the Secure flag — otherwise HTTPS-served deployments would leak
    the token to any accidental HTTP request."""
    import app as app_module

    monkeypatch.setattr(app_module, "COOKIE_SECURE", True)
    with TestClient(app) as c:
        attrs = _login_and_get_set_cookie(c)
    assert attrs.get("secure") is True


# ─── Session expiry ───────────────────────────────────────────────────────────


@pytest.fixture
def _alice_token(client) -> tuple[str, int]:
    """Register alice, log her in, return (session_token, user_id)."""
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "password123"}
    )
    uid = reg.json()["id"]
    login = client.post(
        "/api/auth/login", json={"username": "alice", "password": "password123"}
    )
    return login.cookies["piledger_session"], uid


def _expire_session(token: str) -> None:
    """Rewrite the session row so its expires_at is firmly in the past."""
    from db import db

    past = (datetime.now(timezone.utc) - timedelta(days=1)).strftime(ISO_FMT)
    with db() as conn:
        conn.execute("UPDATE sessions SET expires_at=? WHERE token=?", (past, token))
        conn.commit()


def test_expired_session_rejects_me(client, _alice_token):
    """auth.session_uid filters by expires_at > now; an expired row must 401."""
    token, _ = _alice_token
    # Confirm baseline works before we mutate.
    client.cookies.set("piledger_session", token)
    assert client.get("/api/auth/me").status_code == 200

    _expire_session(token)
    assert client.get("/api/auth/me").status_code == 401


def test_expired_session_rejects_authed_endpoints(client, _alice_token):
    """The same 401 should fire for any require_auth-protected route."""
    token, _ = _alice_token
    _expire_session(token)
    client.cookies.set("piledger_session", token)
    assert client.get("/api/accounts").status_code == 401
    assert client.get("/api/summary").status_code == 401
    assert client.get("/api/prefs").status_code == 401


def test_new_login_sweeps_expired_sessions(client, _alice_token):
    """make_session deletes expired sessions on every fresh login. After a
    second login, the expired token row should no longer exist in the DB."""
    from db import db

    stale_token, _ = _alice_token
    _expire_session(stale_token)

    client.cookies.clear()
    client.post(
        "/api/auth/login", json={"username": "alice", "password": "password123"}
    )

    with db() as conn:
        row = conn.execute(
            "SELECT 1 FROM sessions WHERE token=?", (stale_token,)
        ).fetchone()
    assert row is None
