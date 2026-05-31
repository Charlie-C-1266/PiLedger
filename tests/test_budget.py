"""Tests for the zero-based envelope budget API (`/api/budget*`).

Covers the `GET /api/budget` read aggregate and the income / group / envelope
CRUD. `spent` is driven through the real transactions API. A few read-side tests
predate the CRUD endpoints and still seed the budget tables directly via the DB.
"""

from datetime import datetime, timedelta, timezone

from db import db


def _uid(client) -> int:
    return client.get("/api/auth/me").json()["id"]


def _make_account(client, currency: str = "GBP") -> int:
    return client.post(
        "/api/accounts",
        json={"name": "Main", "type": "current", "currency": currency},
    ).json()["id"]


def _seed_envelope(
    uid: int,
    *,
    category: str = "Groceries",
    budgeted_cents: int = 50000,
    flexible: int = 1,
) -> tuple[int, int]:
    """Insert one group + one envelope for the user; return (group_id, env_id)."""
    with db() as conn:
        gid = conn.execute(
            "INSERT INTO budget_group(user_id, name, color, flexible, sort_order)"
            " VALUES(?, 'Everyday', '#D97757', ?, 0)",
            (uid, flexible),
        ).lastrowid
        eid = conn.execute(
            "INSERT INTO budget_envelope(user_id, group_id, label, category,"
            " budgeted_cents, sort_order) VALUES(?, ?, 'Food', ?, ?, 0)",
            (uid, gid, category, budgeted_cents),
        ).lastrowid
        conn.commit()
    return gid, eid


def _last_month_iso() -> str:
    """An occurred_at timestamp that falls in the previous calendar month."""
    now = datetime.now(timezone.utc)
    last_day_prev = now.replace(day=1) - timedelta(days=1)
    return last_day_prev.strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Auth + empty state ────────────────────────────────────────────────────────


def test_budget_requires_auth(client):
    assert client.get("/api/budget").status_code == 401


def test_empty_budget_returns_empty_arrays(alice):
    body = alice.get("/api/budget").json()
    assert body["incomes"] == []
    assert body["groups"] == []
    assert body["history"] == []
    assert body["base_currency"] == "GBP"
    assert body["missing_rates"] == []


# ── Structure ─────────────────────────────────────────────────────────────────


def test_incomes_returned_as_pounds(alice):
    uid = _uid(alice)
    with db() as conn:
        conn.execute(
            "INSERT INTO budget_income(user_id, label, amount_cents, sort_order)"
            " VALUES(?, 'Salary', 300000, 0)",
            (uid,),
        )
        conn.commit()
    incomes = alice.get("/api/budget").json()["incomes"]
    assert len(incomes) == 1
    assert incomes[0]["label"] == "Salary"
    assert incomes[0]["amount"] == 3000.0


def test_groups_nest_envelopes_and_expose_flexible_bool(alice):
    uid = _uid(alice)
    _seed_envelope(uid, category="Groceries", budgeted_cents=50000, flexible=1)
    group = alice.get("/api/budget").json()["groups"][0]
    assert group["flexible"] is True
    assert len(group["envelopes"]) == 1
    env = group["envelopes"][0]
    assert env["category"] == "Groceries"
    assert env["budgeted"] == 500.0
    assert env["spent"] == 0.0  # no transactions yet


def test_budget_isolated_per_user(alice, bob):
    _seed_envelope(_uid(alice), category="Groceries")
    body = bob.get("/api/budget").json()
    assert body["groups"] == []
    assert body["incomes"] == []


# ── Spent computation ─────────────────────────────────────────────────────────


def test_spent_sums_current_month_negative_txns_in_category(alice):
    uid = _uid(alice)
    acct = _make_account(alice)
    _seed_envelope(uid, category="Groceries")
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": -30.0,
            "merchant": "Tesco",
            "category": "Groceries",
        },
    )
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": -20.0,
            "merchant": "Aldi",
            "category": "Groceries",
        },
    )
    # A positive (income/refund) txn in the same category is ignored…
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": 100.0,
            "merchant": "Refund",
            "category": "Groceries",
        },
    )
    # …and so is spend in a different category.
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": -15.0,
            "merchant": "Shell",
            "category": "Transport",
        },
    )
    env = alice.get("/api/budget").json()["groups"][0]["envelopes"][0]
    assert env["spent"] == 50.0


def test_spent_excludes_prior_months(alice):
    uid = _uid(alice)
    acct = _make_account(alice)
    _seed_envelope(uid, category="Groceries")
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": -40.0,
            "merchant": "Old",
            "category": "Groceries",
            "occurred_at": _last_month_iso(),
        },
    )
    env = alice.get("/api/budget").json()["groups"][0]["envelopes"][0]
    assert env["spent"] == 0.0


def test_spent_converts_foreign_currency_to_base(alice):
    uid = _uid(alice)
    usd = _make_account(alice, currency="USD")
    _seed_envelope(uid, category="Groceries")
    alice.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0.5}]})
    alice.post(
        "/api/transactions",
        json={
            "account_id": usd,
            "amount": -100.0,
            "merchant": "US Store",
            "category": "Groceries",
        },
    )
    body = alice.get("/api/budget").json()
    assert body["groups"][0]["envelopes"][0]["spent"] == 50.0  # 100 USD × 0.5
    assert body["missing_rates"] == []


def test_missing_rate_surfaced_and_falls_back_to_one(alice):
    uid = _uid(alice)
    eur = _make_account(alice, currency="EUR")
    _seed_envelope(uid, category="Groceries")
    alice.post(
        "/api/transactions",
        json={
            "account_id": eur,
            "amount": -80.0,
            "merchant": "EU Store",
            "category": "Groceries",
        },
    )
    body = alice.get("/api/budget").json()
    assert body["missing_rates"] == ["EUR"]
    # Spend isn't silently dropped — falls back to a 1.0 rate.
    assert body["groups"][0]["envelopes"][0]["spent"] == 80.0


# ── Trend history ─────────────────────────────────────────────────────────────


def test_history_shape_and_flat_allocation(alice):
    uid = _uid(alice)
    acct = _make_account(alice)
    _seed_envelope(uid, category="Groceries", budgeted_cents=50000)
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": -25.0,
            "merchant": "Tesco",
            "category": "Groceries",
        },
    )
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": -40.0,
            "merchant": "Old",
            "category": "Groceries",
            "occurred_at": _last_month_iso(),
        },
    )
    history = alice.get("/api/budget").json()["history"]
    assert len(history) == 6
    # Budgeted is the current allocation, flat across every month.
    assert all(p["budgeted"] == 500.0 for p in history)
    # Months are "YYYY-MM", oldest first, ending on the current month.
    assert history[-1]["month"] == datetime.now(timezone.utc).strftime("%Y-%m")
    assert history[-1]["spent"] == 25.0  # current month
    assert history[-2]["spent"] == 40.0  # previous month


def test_history_empty_when_no_envelopes(alice):
    uid = _uid(alice)
    with db() as conn:
        conn.execute(
            "INSERT INTO budget_income(user_id, label, amount_cents, sort_order)"
            " VALUES(?, 'Salary', 300000, 0)",
            (uid,),
        )
        conn.commit()
    # Income but no envelopes → nothing to trend.
    assert alice.get("/api/budget").json()["history"] == []


# ── Income CRUD ───────────────────────────────────────────────────────────────


def test_create_income_appends_and_appears_in_budget(alice):
    a = alice.post("/api/budget/income", json={"label": "Salary", "amount": 3000.0})
    assert a.status_code == 201
    assert a.json()["amount"] == 3000.0
    assert a.json()["sort_order"] == 0
    # A second line appends after the first.
    b = alice.post("/api/budget/income", json={"label": "Side gig"})
    assert b.json()["amount"] == 0.0  # defaults to 0
    assert b.json()["sort_order"] == 1
    incomes = alice.get("/api/budget").json()["incomes"]
    assert [i["label"] for i in incomes] == ["Salary", "Side gig"]


def test_update_income(alice):
    iid = alice.post("/api/budget/income", json={"label": "Salary"}).json()["id"]
    r = alice.put(
        f"/api/budget/income/{iid}", json={"label": "Wages", "amount": 2500.0}
    )
    assert r.status_code == 200
    assert r.json()["label"] == "Wages"
    assert r.json()["amount"] == 2500.0


def test_delete_income(alice):
    iid = alice.post("/api/budget/income", json={"label": "Salary"}).json()["id"]
    assert alice.delete(f"/api/budget/income/{iid}").json() == {"ok": True}
    assert alice.get("/api/budget").json()["incomes"] == []
    assert alice.delete(f"/api/budget/income/{iid}").status_code == 404


def test_income_update_unknown_is_404(alice):
    assert alice.put("/api/budget/income/999", json={"label": "X"}).status_code == 404


def test_income_isolated_between_users(alice, bob):
    iid = alice.post("/api/budget/income", json={"label": "Salary"}).json()["id"]
    assert (
        bob.put(f"/api/budget/income/{iid}", json={"label": "Hax"}).status_code == 404
    )
    assert bob.delete(f"/api/budget/income/{iid}").status_code == 404
    # Alice's row is untouched.
    assert alice.get("/api/budget").json()["incomes"][0]["label"] == "Salary"


def test_income_validation_rejects_bad_payloads(alice):
    assert alice.post("/api/budget/income", json={"label": ""}).status_code == 400
    assert (
        alice.post("/api/budget/income", json={"label": "X", "amount": -5}).status_code
        == 400
    )


# ── Group CRUD ────────────────────────────────────────────────────────────────


def test_create_group_appends_and_appears_in_budget(alice):
    r = alice.post(
        "/api/budget/groups",
        json={"name": "Bills", "color": "#2A6FDB", "flexible": True},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["flexible"] is True
    assert body["color"] == "#2A6FDB"
    assert body["sort_order"] == 0
    assert "envelopes" not in body  # bare group row, no nested envelopes
    groups = alice.get("/api/budget").json()["groups"]
    assert len(groups) == 1
    assert groups[0]["envelopes"] == []  # the aggregate still nests (empty here)


def test_group_defaults_to_fixed(alice):
    body = alice.post("/api/budget/groups", json={"name": "Bills"}).json()
    assert body["flexible"] is False


def test_update_group(alice):
    gid = alice.post("/api/budget/groups", json={"name": "Bills"}).json()["id"]
    r = alice.put(
        f"/api/budget/groups/{gid}",
        json={"name": "Bills & Housing", "flexible": True, "color": "#1F8A5B"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Bills & Housing"
    assert r.json()["flexible"] is True
    assert r.json()["color"] == "#1F8A5B"


def test_delete_group_cascades_its_envelopes(alice):
    uid = _uid(alice)
    gid = alice.post("/api/budget/groups", json={"name": "Bills"}).json()["id"]
    with db() as conn:
        conn.execute(
            "INSERT INTO budget_envelope(user_id, group_id, label, category,"
            " budgeted_cents, sort_order) VALUES(?, ?, 'Rent', 'Bills', 80000, 0)",
            (uid, gid),
        )
        conn.commit()
    assert alice.delete(f"/api/budget/groups/{gid}").json() == {"ok": True}
    with db() as conn:
        remaining = conn.execute(
            "SELECT COUNT(*) FROM budget_envelope WHERE user_id=?", (uid,)
        ).fetchone()[0]
    assert remaining == 0  # envelope cascaded with its group


def test_group_404s_and_isolation(alice, bob):
    gid = alice.post("/api/budget/groups", json={"name": "Bills"}).json()["id"]
    assert alice.put("/api/budget/groups/999", json={"name": "X"}).status_code == 404
    assert bob.put(f"/api/budget/groups/{gid}", json={"name": "Hax"}).status_code == 404
    assert bob.delete(f"/api/budget/groups/{gid}").status_code == 404


def test_group_validation_rejects_bad_payloads(alice):
    assert alice.post("/api/budget/groups", json={"name": ""}).status_code == 400
    assert (
        alice.post("/api/budget/groups", json={"name": "X", "color": "red"}).status_code
        == 400
    )


# ── Envelope CRUD ─────────────────────────────────────────────────────────────


def _make_group(client, name: str = "Bills", flexible: bool = False) -> int:
    return client.post(
        "/api/budget/groups", json={"name": name, "flexible": flexible}
    ).json()["id"]


def test_create_envelope_appears_nested_with_live_spent(alice):
    acct = _make_account(alice)
    gid = _make_group(alice, "Everyday", flexible=True)
    r = alice.post(
        "/api/budget/envelopes",
        json={
            "group_id": gid,
            "label": "Food",
            "category": "Groceries",
            "budgeted": 500.0,
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["category"] == "Groceries"
    assert body["budgeted"] == 500.0
    assert body["sort_order"] == 0
    assert "spent" not in body  # bare CRUD row carries no computed spend
    # Spend in that category this month shows up in the GET aggregate.
    alice.post(
        "/api/transactions",
        json={
            "account_id": acct,
            "amount": -30.0,
            "merchant": "Tesco",
            "category": "Groceries",
        },
    )
    env = alice.get("/api/budget").json()["groups"][0]["envelopes"][0]
    assert env["spent"] == 30.0
    assert env["budgeted"] == 500.0


def test_create_envelope_accepts_a_custom_category(alice):
    gid = _make_group(alice)
    alice.post("/api/categories", json={"name": "Hobbies"})
    r = alice.post(
        "/api/budget/envelopes",
        json={"group_id": gid, "label": "Models", "category": "Hobbies"},
    )
    assert r.status_code == 201


def test_create_envelope_rejects_unknown_category(alice):
    gid = _make_group(alice)
    r = alice.post(
        "/api/budget/envelopes",
        json={"group_id": gid, "label": "X", "category": "Nonsense"},
    )
    assert r.status_code == 422


def test_create_envelope_rejects_duplicate_category(alice):
    g1 = _make_group(alice, "Everyday")
    g2 = _make_group(alice, "Lifestyle")
    alice.post(
        "/api/budget/envelopes",
        json={"group_id": g1, "label": "Food", "category": "Groceries"},
    )
    dup = alice.post(
        "/api/budget/envelopes",
        json={"group_id": g2, "label": "More food", "category": "Groceries"},
    )
    assert dup.status_code == 409


def test_create_envelope_unknown_group_is_404(alice):
    r = alice.post(
        "/api/budget/envelopes",
        json={"group_id": 999, "label": "X", "category": "Groceries"},
    )
    assert r.status_code == 404


def test_create_envelope_cannot_target_another_users_group(alice, bob):
    bob_gid = _make_group(bob)
    r = alice.post(
        "/api/budget/envelopes",
        json={"group_id": bob_gid, "label": "X", "category": "Groceries"},
    )
    assert r.status_code == 404


def test_update_envelope_fields(alice):
    gid = _make_group(alice)
    eid = alice.post(
        "/api/budget/envelopes",
        json={"group_id": gid, "label": "Food", "category": "Groceries"},
    ).json()["id"]
    r = alice.put(
        f"/api/budget/envelopes/{eid}",
        json={"label": "Food & drink", "budgeted": 250.0, "category": "Dining"},
    )
    assert r.status_code == 200
    assert r.json()["label"] == "Food & drink"
    assert r.json()["budgeted"] == 250.0
    assert r.json()["category"] == "Dining"


def test_update_envelope_to_taken_category_is_409(alice):
    gid = _make_group(alice)
    alice.post(
        "/api/budget/envelopes",
        json={"group_id": gid, "label": "Food", "category": "Groceries"},
    )
    eid = alice.post(
        "/api/budget/envelopes",
        json={"group_id": gid, "label": "Out", "category": "Dining"},
    ).json()["id"]
    r = alice.put(f"/api/budget/envelopes/{eid}", json={"category": "Groceries"})
    assert r.status_code == 409


def test_update_envelope_can_move_to_another_owned_group(alice):
    g1 = _make_group(alice, "Everyday")
    g2 = _make_group(alice, "Lifestyle")
    eid = alice.post(
        "/api/budget/envelopes",
        json={"group_id": g1, "label": "Food", "category": "Groceries"},
    ).json()["id"]
    assert (
        alice.put(f"/api/budget/envelopes/{eid}", json={"group_id": g2}).json()[
            "group_id"
        ]
        == g2
    )
    # Moving into a group owned by someone else is rejected.
    assert (
        alice.put(f"/api/budget/envelopes/{eid}", json={"group_id": 999}).status_code
        == 404
    )


def test_delete_envelope_and_isolation(alice, bob):
    gid = _make_group(alice)
    eid = alice.post(
        "/api/budget/envelopes",
        json={"group_id": gid, "label": "Food", "category": "Groceries"},
    ).json()["id"]
    # Another user can't see or touch it.
    assert (
        bob.put(f"/api/budget/envelopes/{eid}", json={"label": "Hax"}).status_code
        == 404
    )
    assert bob.delete(f"/api/budget/envelopes/{eid}").status_code == 404
    # The owner can delete it; freeing the category for re-use.
    assert alice.delete(f"/api/budget/envelopes/{eid}").json() == {"ok": True}
    assert alice.delete(f"/api/budget/envelopes/{eid}").status_code == 404
    reuse = alice.post(
        "/api/budget/envelopes",
        json={"group_id": gid, "label": "Food again", "category": "Groceries"},
    )
    assert reuse.status_code == 201
