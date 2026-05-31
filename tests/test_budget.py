"""Tests for the zero-based envelope budget read API (`GET /api/budget`).

The CRUD endpoints land in later phases, so these tests seed the budget tables
directly via the DB and drive actual `spent` through the real transactions API.
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
