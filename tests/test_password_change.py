"""
Tests for `PUT /api/auth/password` — self-serve password change.

The route's contract has three load-bearing properties beyond plain
validation:

* The current password must be verified — otherwise a stolen session
  cookie alone could change the credential and lock the legitimate user
  out (a classic post-XSS escalation path).
* Every session for the user must be invalidated and re-issued — if a
  separate device's session has been stolen, the password change has to
  kick it out. The legitimate device gets a fresh cookie on the same
  response so the rotation is seamless from that side.
* The login round-trip must use the new password and reject the old —
  pinned end-to-end so a regression that wrote the hash incorrectly
  (e.g. forgot to call `hash_password`, or hashed the *old* password)
  is caught immediately.
"""
from fastapi.testclient import TestClient


# ── Auth + validation ────────────────────────────────────────────────────────

def test_password_change_requires_auth(client):
    r = client.put("/api/auth/password", json={
        "current_password": "password123",
        "new_password": "newpassword123",
    })
    assert r.status_code == 401


def test_password_change_wrong_current_returns_401(alice):
    r = alice.put("/api/auth/password", json={
        "current_password": "WRONG",
        "new_password": "newpassword123",
    })
    assert r.status_code == 401
    assert r.json()["detail"] == "Current password is incorrect"


def test_password_change_short_new_password_returns_400(alice):
    """`PasswordChangeIn` mirrors `RegisterIn`'s 8-char floor — a change can
    never weaken a password below the registration policy."""
    r = alice.put("/api/auth/password", json={
        "current_password": "password123",
        "new_password": "short",
    })
    assert r.status_code == 400


def test_password_change_rejects_unknown_fields(alice):
    # `_In` uses extra="forbid".
    r = alice.put("/api/auth/password", json={
        "current_password": "password123",
        "new_password": "newpassword123",
        "wat": 1,
    })
    assert r.status_code == 400


def test_password_change_rejects_missing_fields(alice):
    assert alice.put("/api/auth/password",
                     json={"current_password": "password123"}).status_code == 400
    assert alice.put("/api/auth/password",
                     json={"new_password": "newpassword123"}).status_code == 400


# ── Happy path round-trip ────────────────────────────────────────────────────

def test_password_change_returns_ok_and_rotates_cookie(alice):
    pre_cookie = alice.cookies.get("piledger_session")
    assert pre_cookie

    r = alice.put("/api/auth/password", json={
        "current_password": "password123",
        "new_password": "newpassword123",
    })
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # The response carries a Set-Cookie with the new token. httpx pulls it
    # into the client jar automatically, so the next request continues
    # authenticated — verify that and that the token has actually changed.
    post_cookie = alice.cookies.get("piledger_session")
    assert post_cookie is not None
    assert post_cookie != pre_cookie, "new session token must differ from old"

    # And the new cookie keeps the same client authenticated.
    assert alice.get("/api/auth/me").status_code == 200


def test_password_change_login_round_trip(app):
    """After a change, the new password works for fresh logins and the old
    password is rejected — pins the credential is actually persisted (not
    just the in-memory session state) and that the hash was written
    correctly."""
    with TestClient(app) as c:
        c.post("/api/auth/register",
               json={"username": "alice", "password": "password123"})
        c.post("/api/auth/login",
               json={"username": "alice", "password": "password123"})
        c.put("/api/auth/password", json={
            "current_password": "password123",
            "new_password": "newpassword123",
        })

    # Old password → 401.
    with TestClient(app) as c:
        assert c.post("/api/auth/login", json={
            "username": "alice", "password": "password123",
        }).status_code == 401

    # New password → 200.
    with TestClient(app) as c:
        r = c.post("/api/auth/login", json={
            "username": "alice", "password": "newpassword123",
        })
        assert r.status_code == 200


# ── Session rotation ─────────────────────────────────────────────────────────

def test_password_change_invalidates_pre_change_session_token(alice):
    """The pre-change cookie value must stop authenticating server-side —
    not just locally. Snapshot it, perform the change, then re-attach it
    to the client jar and prove the *server* rejects it."""
    pre_cookie = alice.cookies.get("piledger_session")

    alice.put("/api/auth/password", json={
        "current_password": "password123",
        "new_password": "newpassword123",
    })

    # The client jar now holds the new cookie — overwrite it with the old
    # one and confirm the server refuses to authenticate.
    alice.cookies.set("piledger_session", pre_cookie)
    assert alice.get("/api/auth/me").status_code == 401


def test_password_change_kills_other_sessions_for_same_user(app):
    """Two concurrent sessions for the same user, then a password change
    via one of them — both pre-change tokens must stop working."""
    with TestClient(app) as c:
        c.post("/api/auth/register",
               json={"username": "alice", "password": "password123"})

    # Two independent login sessions.
    with TestClient(app) as device_a, TestClient(app) as device_b:
        device_a.post("/api/auth/login",
                      json={"username": "alice", "password": "password123"})
        device_b.post("/api/auth/login",
                      json={"username": "alice", "password": "password123"})
        token_a = device_a.cookies.get("piledger_session")
        token_b = device_b.cookies.get("piledger_session")
        assert token_a and token_b and token_a != token_b

        # Device A changes the password — device B's session must die.
        r = device_a.put("/api/auth/password", json={
            "current_password": "password123",
            "new_password": "newpassword123",
        })
        assert r.status_code == 200

        # Device A continues to work (new cookie set on the response).
        assert device_a.get("/api/auth/me").status_code == 200

        # Device B's still-cached token no longer authenticates server-side.
        assert device_b.get("/api/auth/me").status_code == 401


# ── Cross-user isolation ─────────────────────────────────────────────────────

def test_password_change_does_not_touch_other_users(alice, bob):
    alice.put("/api/auth/password", json={
        "current_password": "password123",
        "new_password": "newpassword123",
    })
    # Bob's session is unaffected.
    assert bob.get("/api/auth/me").status_code == 200
    # And bob's original password still works for a fresh login.
    fresh_login = bob.post("/api/auth/login",
                           json={"username": "bob", "password": "password123"})
    assert fresh_login.status_code == 200
