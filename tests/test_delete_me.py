"""
Tests for `DELETE /api/auth/me` — self-serve account deletion.

The route must: require auth, re-verify the password, cascade-clear every
user-scoped row, kill all sessions for that user, drop the `users` row, and
clear the session cookie on the response. None of the cleanup can leak into
another user's data.
"""

from db import USER_SCOPED_TABLES, db, user_scoped_select_sql


# ── Auth gate ────────────────────────────────────────────────────────────────


def test_delete_me_requires_auth(client):
    assert (
        client.request(
            "DELETE", "/api/auth/me", json={"password": "password123"}
        ).status_code
        == 401
    )


def test_delete_me_wrong_password_returns_401(alice):
    r = alice.request("DELETE", "/api/auth/me", json={"password": "WRONG"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid password"


def test_delete_me_missing_password_is_400(alice):
    r = alice.request("DELETE", "/api/auth/me", json={})
    assert r.status_code == 400


def test_delete_me_rejects_unknown_fields(alice):
    # _In uses extra="forbid".
    r = alice.request(
        "DELETE", "/api/auth/me", json={"password": "password123", "wat": 1}
    )
    assert r.status_code == 400


# ── Happy path ───────────────────────────────────────────────────────────────


def _seed(client):
    acct = client.post(
        "/api/accounts",
        json={
            "name": "Main",
            "type": "current",
            "currency": "GBP",
        },
    ).json()
    client.post(f"/api/accounts/{acct['id']}/balance", json={"balance": 100.0})
    client.post(
        "/api/budget",
        json={
            "account_id": acct["id"],
            "name": "Rent",
            "amount": -800.0,
            "frequency": "monthly",
        },
    )
    client.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0.78}]})
    return acct


def test_delete_me_clears_every_user_scoped_table(alice):
    _seed(alice)
    # Find the user id by reading /api/auth/me before the delete.
    uid = alice.get("/api/auth/me").json()["id"]

    r = alice.request("DELETE", "/api/auth/me", json={"password": "password123"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    with db() as conn:
        # The users row itself is gone.
        assert conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone() is None
        # Every user-scoped table has zero rows for this user.
        for table in USER_SCOPED_TABLES:
            rows = conn.execute(user_scoped_select_sql(table), (uid,)).fetchall()
            assert rows == [], f"{table} still holds rows for deleted user {uid}"
        # Sessions for the deleted user are gone too.
        assert (
            conn.execute("SELECT 1 FROM sessions WHERE user_id=?", (uid,)).fetchone()
            is None
        )


def test_delete_me_clears_session_cookie(alice):
    r = alice.request("DELETE", "/api/auth/me", json={"password": "password123"})
    assert r.status_code == 200
    cookie_headers = [v for k, v in r.headers.items() if k.lower() == "set-cookie"]
    # The cookie clear is communicated as a Set-Cookie line with Max-Age=0
    # (or an explicit expires-in-the-past). Either way, the session-cookie
    # name must appear in the Set-Cookie set with a clearing attribute.
    assert any(
        "piledger_session=" in c and ("Max-Age=0" in c or "expires=" in c.lower())
        for c in cookie_headers
    ), cookie_headers


def test_delete_me_invalidates_old_session_token(alice):
    # Snapshot the session token, then perform the delete via that same
    # client (which still presents the cookie on the DELETE). After the
    # delete, a fresh request with the same cookie must 401 — the row in
    # `sessions` is gone, so `session_uid` returns None.
    pre_cookie = alice.cookies.get("piledger_session")
    assert pre_cookie

    r = alice.request("DELETE", "/api/auth/me", json={"password": "password123"})
    assert r.status_code == 200

    # The TestClient's own cookie jar was updated by the Set-Cookie clearer,
    # so re-attach the pre-delete cookie to prove the *server* no longer
    # accepts it (rather than the client just dropping it locally).
    alice.cookies.set("piledger_session", pre_cookie)
    assert alice.get("/api/auth/me").status_code == 401


# ── Cross-user isolation ─────────────────────────────────────────────────────


def test_delete_me_does_not_touch_other_users(alice, bob):
    _seed(alice)
    bob_acct = _seed(bob)

    alice.request("DELETE", "/api/auth/me", json={"password": "password123"})

    # Bob can still read his data through the API.
    accts = bob.get("/api/accounts").json()
    assert len(accts) == 1
    assert accts[0]["id"] == bob_acct["id"]
    # ...and the underlying rows survive.
    bob_uid = bob.get("/api/auth/me").json()["id"]
    with db() as conn:
        for table in USER_SCOPED_TABLES:
            rows = conn.execute(user_scoped_select_sql(table), (bob_uid,)).fetchall()
            assert rows, f"bob's {table} rows should survive alice's delete"


def test_delete_me_frees_username_for_reuse(alice):
    """After deletion the username must be re-registerable."""
    r = alice.request("DELETE", "/api/auth/me", json={"password": "password123"})
    assert r.status_code == 200
    # `alice` is a TestClient instance; use it to drive a fresh registration.
    r = alice.post(
        "/api/auth/register", json={"username": "alice", "password": "differentpass"}
    )
    assert r.status_code == 201
