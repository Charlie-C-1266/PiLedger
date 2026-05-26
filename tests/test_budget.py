"""Tests for the budget items API surface.

Prior to this file, the only coverage was a single round-trip in
``test_loans.py``. The other budget endpoints — auth, user isolation,
validation, cascading delete, partial PATCH semantics — were unguarded.
"""

from constants import MAX_MONEY


# ── Auth ──────────────────────────────────────────────────────────────────────


def test_list_budget_requires_auth(client):
    assert client.get("/api/budget").status_code == 401


def test_create_budget_requires_auth(client):
    assert (
        client.post(
            "/api/budget",
            json={
                "account_id": 1,
                "name": "X",
                "amount": 100.0,
                "frequency": "monthly",
            },
        ).status_code
        == 401
    )


def test_update_budget_requires_auth(client):
    assert client.put("/api/budget/1", json={"name": "X"}).status_code == 401


def test_delete_budget_requires_auth(client):
    assert client.delete("/api/budget/1").status_code == 401


# ── Create + list ─────────────────────────────────────────────────────────────


def test_create_budget_returns_201_and_appears_in_list(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    r = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Salary",
            "amount": 3000.0,
            "frequency": "monthly",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["account_id"] == aid
    assert body["name"] == "Salary"
    assert body["amount"] == 3000.0
    assert body["frequency"] == "monthly"

    items = alice.get("/api/budget").json()
    assert len(items) == 1
    assert items[0]["id"] == body["id"]


def test_create_budget_unknown_account_returns_404(alice):
    r = alice.post(
        "/api/budget",
        json={
            "account_id": 99999,
            "name": "X",
            "amount": 100.0,
            "frequency": "monthly",
        },
    )
    assert r.status_code == 404


# ── User isolation ────────────────────────────────────────────────────────────


def test_user_cannot_post_budget_against_another_users_account(alice, bob):
    """The account_id ownership check at app.py:643-646 should reject this."""
    alice_acc = alice.post(
        "/api/accounts", json={"name": "Alice's", "type": "current"}
    ).json()["id"]
    r = bob.post(
        "/api/budget",
        json={
            "account_id": alice_acc,
            "name": "Sneaky",
            "amount": 100.0,
            "frequency": "monthly",
        },
    )
    assert r.status_code == 404


def test_list_budget_user_isolation(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Salary",
            "amount": 1000.0,
            "frequency": "monthly",
        },
    )
    assert bob.get("/api/budget").json() == []


def test_user_cannot_update_another_users_budget(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    bid = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Salary",
            "amount": 1000.0,
            "frequency": "monthly",
        },
    ).json()["id"]
    assert bob.put(f"/api/budget/{bid}", json={"name": "Hijacked"}).status_code == 404
    # And alice's record is untouched.
    assert alice.get("/api/budget").json()[0]["name"] == "Salary"


def test_user_cannot_delete_another_users_budget(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    bid = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Salary",
            "amount": 1000.0,
            "frequency": "monthly",
        },
    ).json()["id"]
    assert bob.delete(f"/api/budget/{bid}").status_code == 404
    assert len(alice.get("/api/budget").json()) == 1


# ── Nonexistent + cascade ─────────────────────────────────────────────────────


def test_update_nonexistent_budget_returns_404(alice):
    assert alice.put("/api/budget/99999", json={"name": "X"}).status_code == 404


def test_delete_nonexistent_budget_returns_404(alice):
    assert alice.delete("/api/budget/99999").status_code == 404


def test_deleting_account_cascades_to_its_budget_items(alice):
    """db.py:95 declares ON DELETE CASCADE; deleting the parent account should
    remove every budget item attached to it (and only those)."""
    keep_acc = alice.post(
        "/api/accounts", json={"name": "Keep", "type": "current"}
    ).json()["id"]
    drop_acc = alice.post(
        "/api/accounts", json={"name": "Drop", "type": "current"}
    ).json()["id"]

    keep_item = alice.post(
        "/api/budget",
        json={
            "account_id": keep_acc,
            "name": "Keep me",
            "amount": 100.0,
            "frequency": "monthly",
        },
    ).json()["id"]
    alice.post(
        "/api/budget",
        json={
            "account_id": drop_acc,
            "name": "Drop me",
            "amount": 200.0,
            "frequency": "monthly",
        },
    )

    alice.delete(f"/api/accounts/{drop_acc}")

    remaining = alice.get("/api/budget").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == keep_item


# ── Validation ────────────────────────────────────────────────────────────────


def test_create_budget_rejects_blank_name(alice):
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    r = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "",
            "amount": 100.0,
            "frequency": "monthly",
        },
    )
    assert r.status_code == 400


def test_create_budget_rejects_unknown_frequency(alice):
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    r = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "X",
            "amount": 100.0,
            "frequency": "daily",
        },
    )
    assert r.status_code == 400


def test_create_budget_rejects_amount_above_max_money(alice):
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    r = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "X",
            "amount": MAX_MONEY + 1,
            "frequency": "monthly",
        },
    )
    assert r.status_code == 400


def test_create_budget_rejects_extra_field(alice):
    """BudgetItemIn inherits _In which forbids unknown keys."""
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    r = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "X",
            "amount": 100.0,
            "frequency": "monthly",
            "secret_flag": True,
        },
    )
    assert r.status_code == 400


def test_negative_amount_accepted_for_loan_payments(alice):
    """Loan payments (cash leaving the budget) are encoded as a negative amount.
    Already implicitly relied on by test_loans.py — pinned here as a contract."""
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    r = alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Loan payment",
            "amount": -500.0,
            "frequency": "monthly",
        },
    )
    assert r.status_code == 201
    assert r.json()["amount"] == -500.0


# ── Partial PATCH semantics ───────────────────────────────────────────────────


def _seed_item(alice):
    aid = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    return alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Original",
            "amount": 1000.0,
            "frequency": "monthly",
        },
    ).json()


def test_patch_name_only_leaves_amount_and_frequency_unchanged(alice):
    item = _seed_item(alice)
    r = alice.put(f"/api/budget/{item['id']}", json={"name": "Renamed"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed"
    assert body["amount"] == 1000.0
    assert body["frequency"] == "monthly"


def test_patch_amount_only_leaves_name_and_frequency_unchanged(alice):
    item = _seed_item(alice)
    r = alice.put(f"/api/budget/{item['id']}", json={"amount": 2500.0})
    assert r.status_code == 200
    body = r.json()
    assert body["amount"] == 2500.0
    assert body["name"] == "Original"
    assert body["frequency"] == "monthly"


def test_patch_frequency_only_leaves_name_and_amount_unchanged(alice):
    item = _seed_item(alice)
    r = alice.put(f"/api/budget/{item['id']}", json={"frequency": "weekly"})
    assert r.status_code == 200
    body = r.json()
    assert body["frequency"] == "weekly"
    assert body["name"] == "Original"
    assert body["amount"] == 1000.0


def test_patch_empty_body_is_noop(alice):
    """app.py:672 short-circuits the UPDATE when patch is empty but still
    returns the unmodified row."""
    item = _seed_item(alice)
    r = alice.put(f"/api/budget/{item['id']}", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Original"
    assert body["amount"] == 1000.0
    assert body["frequency"] == "monthly"


# ── Projection: FREQ_TO_MONTHLY multipliers ──────────────────────────────────
# Prior to these tests, only "monthly" was ever passed to /api/budget/projection.
# A typo in the weekly (52/12), quarterly (1/3), or annually (1/12) multiplier
# would have shipped undetected (test coverage audit P1 #2).


def _make_account_with_budget(alice, *, amount, frequency, balance=0.0):
    aid = alice.post(
        "/api/accounts",
        json={"name": f"Acc-{frequency}", "type": "current"},
    ).json()["id"]
    if balance:
        alice.post(f"/api/accounts/{aid}/balance", json={"balance": balance})
    alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": f"Item-{frequency}",
            "amount": amount,
            "frequency": frequency,
        },
    )
    return aid


def test_weekly_frequency_uses_correct_multiplier(alice):
    """£100/week should project as £100 × 52/12 ≈ £433.33/month."""
    aid = _make_account_with_budget(alice, amount=100.0, frequency="weekly")
    proj = alice.get("/api/budget/projection?months=3").json()
    acc = next(a for a in proj["accounts"] if a["id"] == aid)
    expected_monthly = round(100.0 * 52 / 12, 2)
    assert acc["monthly_net"] == expected_monthly
    assert acc["points"][1]["balance"] == expected_monthly


def test_quarterly_frequency_uses_correct_multiplier(alice):
    """£900/quarter should project as £900 × 1/3 = £300/month."""
    aid = _make_account_with_budget(alice, amount=900.0, frequency="quarterly")
    proj = alice.get("/api/budget/projection?months=3").json()
    acc = next(a for a in proj["accounts"] if a["id"] == aid)
    expected_monthly = round(900.0 * 1 / 3, 2)
    assert acc["monthly_net"] == expected_monthly
    assert acc["points"][1]["balance"] == expected_monthly


def test_annually_frequency_uses_correct_multiplier(alice):
    """£12000/year should project as £12000 × 1/12 = £1000/month."""
    aid = _make_account_with_budget(alice, amount=12000.0, frequency="annually")
    proj = alice.get("/api/budget/projection?months=3").json()
    acc = next(a for a in proj["accounts"] if a["id"] == aid)
    expected_monthly = round(12000.0 * 1 / 12, 2)
    assert acc["monthly_net"] == expected_monthly
    assert acc["points"][1]["balance"] == expected_monthly


def test_monthly_frequency_multiplier_is_identity(alice):
    """Sanity: £500/month should project as exactly £500/month."""
    aid = _make_account_with_budget(alice, amount=500.0, frequency="monthly")
    proj = alice.get("/api/budget/projection?months=3").json()
    acc = next(a for a in proj["accounts"] if a["id"] == aid)
    assert acc["monthly_net"] == 500.0
    assert acc["points"][1]["balance"] == 500.0


def test_mixed_frequencies_accumulate_correctly(alice):
    """Multiple budget items with different frequencies on one account
    should all be normalised to monthly and summed."""
    aid = alice.post("/api/accounts", json={"name": "Mixed", "type": "current"}).json()[
        "id"
    ]
    alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Weekly",
            "amount": 100.0,
            "frequency": "weekly",
        },
    )
    alice.post(
        "/api/budget",
        json={
            "account_id": aid,
            "name": "Annually",
            "amount": -1200.0,
            "frequency": "annually",
        },
    )
    proj = alice.get("/api/budget/projection?months=3").json()
    acc = next(a for a in proj["accounts"] if a["id"] == aid)
    expected = round(100.0 * 52 / 12 + (-1200.0) * 1 / 12, 2)
    assert acc["monthly_net"] == expected


# ── Projection: months validation ────────────────────────────────────────────
# The in-route allow-list (months must be 3, 6, or 12) is stricter than the
# Query(ge=1, le=12) constraint (test coverage audit P1 #3).


def test_projection_rejects_months_not_in_allowed_set(alice):
    for bad_months in (1, 2, 4, 5, 7, 8, 9, 10, 11):
        r = alice.get(f"/api/budget/projection?months={bad_months}")
        assert r.status_code == 400, f"months={bad_months} should be rejected"


def test_projection_accepts_valid_months(alice):
    for good_months in (3, 6, 12):
        r = alice.get(f"/api/budget/projection?months={good_months}")
        assert r.status_code == 200, f"months={good_months} should be accepted"


def test_projection_requires_auth(client):
    assert client.get("/api/budget/projection").status_code == 401
