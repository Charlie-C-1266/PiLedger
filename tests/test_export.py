"""
Tests for `GET /api/export` — user-scoped JSON dump.

Pins the public contract (auth gate, response shape, attachment header,
cross-user isolation) plus the schema-drift guard that catches any future
user-scoped table missing from `db.USER_SCOPED_TABLES`. Without that guard,
adding a new user-table without remembering to extend `USER_SCOPED_TABLES`
would silently break both the export and the `DELETE /api/auth/me` cascade.
"""
import json

from db import USER_SCOPED_TABLES, db


# ── Auth gate ────────────────────────────────────────────────────────────────

def test_export_requires_auth(client):
    assert client.get("/api/export").status_code == 401


# ── Response shape ───────────────────────────────────────────────────────────

def test_export_for_new_user_returns_empty_tables(alice):
    r = alice.get("/api/export")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 1
    assert "exported_at" in body and body["exported_at"].endswith("Z")
    assert body["user"]["username"] == "alice"
    for table in USER_SCOPED_TABLES:
        assert body[table] == [], table


def test_export_omits_password_hash(alice):
    body = alice.get("/api/export").json()
    assert "password_hash" not in body["user"]


def test_export_attachment_header(alice):
    r = alice.get("/api/export")
    cd = r.headers.get("content-disposition", "")
    assert cd.startswith("attachment;")
    assert "piledger-export-alice-" in cd
    assert cd.endswith('.json"')


# ── Round-trip ───────────────────────────────────────────────────────────────

def _seed_alice(alice):
    acct = alice.post("/api/accounts", json={
        "name": "Main", "type": "current", "currency": "GBP",
    }).json()
    alice.post(f"/api/accounts/{acct['id']}/balance", json={"balance": 1234.56})
    alice.post(f"/api/accounts/{acct['id']}/balance", json={"balance": 1400.00})
    alice.post("/api/budget", json={
        "account_id": acct["id"], "name": "Rent",
        "amount": -800.0, "frequency": "monthly",
    })
    alice.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0.78}]})
    return acct


def test_export_round_trips_every_user_scoped_table(alice):
    acct = _seed_alice(alice)
    body = alice.get("/api/export").json()

    assert len(body["accounts"]) == 1
    assert body["accounts"][0]["id"] == acct["id"]
    assert body["accounts"][0]["name"] == "Main"
    assert body["accounts"][0]["currency"] == "GBP"

    assert len(body["balance_history"]) == 2
    assert {row["balance_cents"] for row in body["balance_history"]} == {123456, 140000}

    assert len(body["budget_items"]) == 1
    assert body["budget_items"][0]["amount_cents"] == -80000

    assert len(body["exchange_rates"]) == 1
    assert body["exchange_rates"][0]["currency"] == "USD"
    assert body["exchange_rates"][0]["rate"] == 0.78


def test_export_is_valid_json_bytes(alice):
    _seed_alice(alice)
    r = alice.get("/api/export")
    # Response body must parse cleanly via `json.loads` — the attachment-saved
    # file must be importable by any downstream tool that expects strict JSON.
    parsed = json.loads(r.content)
    assert parsed["user"]["username"] == "alice"


# ── Cross-user isolation ─────────────────────────────────────────────────────

def test_alice_export_excludes_bobs_data(alice, bob):
    _seed_alice(alice)
    bob_acct = bob.post("/api/accounts", json={
        "name": "Bob's Stash", "type": "savings", "currency": "USD",
    }).json()
    bob.post(f"/api/accounts/{bob_acct['id']}/balance", json={"balance": 99.0})

    alice_body = alice.get("/api/export").json()
    bob_body = bob.get("/api/export").json()

    assert alice_body["user"]["username"] == "alice"
    assert bob_body["user"]["username"] == "bob"
    assert all(a["name"] != "Bob's Stash" for a in alice_body["accounts"])
    assert all(a["name"] != "Main" for a in bob_body["accounts"])
    # Balance history is reached via the accounts join — verify the join
    # doesn't accidentally pull rows from accounts owned by other users.
    assert all(row["balance_cents"] != 9900 for row in alice_body["balance_history"])
    assert all(row["balance_cents"] not in (123456, 140000)
               for row in bob_body["balance_history"])


# ── Schema-drift guard ───────────────────────────────────────────────────────

def test_user_scoped_tables_covers_every_user_keyed_table(app):
    """If a new table with `user_id` or `account_id` lands in the schema
    without also being added to `USER_SCOPED_TABLES`, this test trips —
    forcing the author to extend the export route and the delete-me
    cascade in lock-step rather than leaving one behind.
    """
    # `users` is the user row itself (special-cased in both routes); `sessions`
    # is auth state, not user data, and is wiped on delete but not exported.
    EXEMPT = {"users", "sessions"}

    with db() as conn:
        tables = [
            r["name"] for r in conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        ]
        assert tables, "expected at least one user table in the schema"
        for table in tables:
            if table in EXEMPT:
                continue
            cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if "user_id" in cols or "account_id" in cols:
                assert table in USER_SCOPED_TABLES, (
                    f"table '{table}' is user-scoped (has user_id or account_id) "
                    f"but is missing from db.USER_SCOPED_TABLES — extend the "
                    f"constant so the export and delete-me cascade pick it up"
                )


def test_user_scoped_tables_does_not_list_phantom_tables(app):
    """Conversely, every table named in `USER_SCOPED_TABLES` must actually
    exist in the schema — otherwise the export would raise OperationalError."""
    with db() as conn:
        existing = {
            r["name"] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for table in USER_SCOPED_TABLES:
            assert table in existing, f"USER_SCOPED_TABLES names missing table '{table}'"
