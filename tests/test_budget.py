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
