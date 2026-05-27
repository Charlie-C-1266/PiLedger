"""
Tests for transaction CRUD endpoints:
  GET    /api/transactions
  POST   /api/transactions
  PUT    /api/transactions/{tid}
  DELETE /api/transactions/{tid}
"""

from constants import MAX_MONEY


def _acct(client, **kw):
    payload = {"name": "Main", "type": "current", **kw}
    return client.post("/api/accounts", json=payload).json()["id"]


def _txn(client, account_id, **kw):
    payload = {
        "account_id": account_id,
        "amount": -42.50,
        "merchant": "Tesco",
        **kw,
    }
    return client.post("/api/transactions", json=payload).json()


# ── Auth gates ───────────────────────────────────────────────────────────────


def test_list_transactions_requires_auth(client):
    assert client.get("/api/transactions").status_code == 401


def test_create_transaction_requires_auth(client):
    assert client.post("/api/transactions", json={}).status_code == 401


def test_update_transaction_requires_auth(client):
    assert client.put("/api/transactions/1", json={}).status_code == 401


def test_delete_transaction_requires_auth(client):
    assert client.delete("/api/transactions/1").status_code == 401


# ── Create + List ────────────────────────────────────────────────────────────


def test_create_returns_201_and_fields_correct(alice):
    aid = _acct(alice)
    r = alice.post(
        "/api/transactions",
        json={
            "account_id": aid,
            "amount": -19.99,
            "merchant": "Costa",
            "category": "Coffee",
            "note": "Morning latte",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["amount"] == -19.99
    assert body["merchant"] == "Costa"
    assert body["category"] == "Coffee"
    assert body["note"] == "Morning latte"
    assert body["account_id"] == aid
    assert "id" in body
    assert "created_at" in body
    assert "occurred_at" in body


def test_create_defaults_occurred_at_to_now(alice):
    aid = _acct(alice)
    txn = _txn(alice, aid)
    assert txn["occurred_at"] is not None
    assert txn["occurred_at"].endswith("Z")


def test_create_respects_custom_occurred_at(alice):
    aid = _acct(alice)
    ts = "2025-06-15T12:30:00Z"
    txn = _txn(alice, aid, occurred_at=ts)
    assert txn["occurred_at"] == ts


def test_create_unknown_account_returns_404(alice):
    r = alice.post(
        "/api/transactions",
        json={"account_id": 99999, "amount": 10, "merchant": "X"},
    )
    assert r.status_code == 404


def test_created_transaction_appears_in_list(alice):
    aid = _acct(alice)
    txn = _txn(alice, aid, merchant="Waitrose")
    items = alice.get("/api/transactions").json()
    assert any(t["id"] == txn["id"] for t in items)


def test_negative_amount_accepted(alice):
    aid = _acct(alice)
    txn = _txn(alice, aid, amount=-250.0)
    assert txn["amount"] == -250.0


# ── Search / Filter / Sort / Pagination ──────────────────────────────────────


def test_search_filters_by_merchant(alice):
    aid = _acct(alice)
    _txn(alice, aid, merchant="Tesco Express")
    _txn(alice, aid, merchant="Sainsburys")
    results = alice.get("/api/transactions?search=Tesco").json()
    assert all("Tesco" in t["merchant"] for t in results)
    assert len(results) == 1


def test_search_filters_by_category(alice):
    aid = _acct(alice)
    _txn(alice, aid, merchant="Shell", category="Fuel")
    _txn(alice, aid, merchant="BP", category="Fuel")
    _txn(alice, aid, merchant="Costa", category="Coffee")
    results = alice.get("/api/transactions?search=Fuel").json()
    assert len(results) == 2


def test_search_is_case_insensitive(alice):
    aid = _acct(alice)
    _txn(alice, aid, merchant="TESCO")
    results = alice.get("/api/transactions?search=tesco").json()
    assert len(results) == 1


def test_filter_by_account(alice):
    a1 = _acct(alice, name="Account A")
    a2 = _acct(alice, name="Account B")
    _txn(alice, a1, merchant="A-merchant")
    _txn(alice, a2, merchant="B-merchant")
    results = alice.get(f"/api/transactions?account={a1}").json()
    assert len(results) == 1
    assert results[0]["account_id"] == a1


def test_filter_by_category(alice):
    aid = _acct(alice)
    _txn(alice, aid, merchant="X", category="Bills")
    _txn(alice, aid, merchant="Y", category="Food")
    results = alice.get("/api/transactions?category=Bills").json()
    assert len(results) == 1
    assert results[0]["category"] == "Bills"


def test_sort_by_date_default(alice):
    aid = _acct(alice)
    _txn(alice, aid, merchant="First", occurred_at="2025-01-01T00:00:00Z")
    _txn(alice, aid, merchant="Second", occurred_at="2025-06-01T00:00:00Z")
    results = alice.get("/api/transactions").json()
    assert results[0]["merchant"] == "Second"
    assert results[1]["merchant"] == "First"


def test_sort_by_amount(alice):
    aid = _acct(alice)
    _txn(alice, aid, merchant="Small", amount=-5.0)
    _txn(alice, aid, merchant="Big", amount=-500.0)
    _txn(alice, aid, merchant="Medium", amount=100.0)
    results = alice.get("/api/transactions?sort=amount").json()
    assert results[0]["merchant"] == "Big"


def test_pagination(alice):
    aid = _acct(alice)
    for i in range(5):
        _txn(alice, aid, merchant=f"M{i}", occurred_at=f"2025-01-0{i + 1}T00:00:00Z")
    page1 = alice.get("/api/transactions?page=1&per_page=2").json()
    page2 = alice.get("/api/transactions?page=2&per_page=2").json()
    assert len(page1) == 2
    assert len(page2) == 2
    ids_1 = {t["id"] for t in page1}
    ids_2 = {t["id"] for t in page2}
    assert ids_1.isdisjoint(ids_2)


# ── User isolation ───────────────────────────────────────────────────────────


def test_user_cannot_see_others_transactions(alice, bob):
    aid = _acct(alice)
    _txn(alice, aid)
    assert bob.get("/api/transactions").json() == []


def test_user_cannot_post_against_others_account(alice, bob):
    aid = _acct(alice)
    r = bob.post(
        "/api/transactions",
        json={"account_id": aid, "amount": 10, "merchant": "Hack"},
    )
    assert r.status_code == 404


def test_user_cannot_update_others_transaction(alice, bob):
    aid = _acct(alice)
    txn = _txn(alice, aid)
    r = bob.put(f"/api/transactions/{txn['id']}", json={"merchant": "Hijacked"})
    assert r.status_code == 404
    refreshed = alice.get("/api/transactions").json()
    assert refreshed[0]["merchant"] == "Tesco"


def test_user_cannot_delete_others_transaction(alice, bob):
    aid = _acct(alice)
    txn = _txn(alice, aid)
    assert bob.delete(f"/api/transactions/{txn['id']}").status_code == 404
    assert len(alice.get("/api/transactions").json()) == 1


# ── Update ───────────────────────────────────────────────────────────────────


def test_patch_merchant_only(alice):
    aid = _acct(alice)
    txn = _txn(alice, aid, merchant="Old", amount=-10.0)
    r = alice.put(f"/api/transactions/{txn['id']}", json={"merchant": "New"})
    assert r.status_code == 200
    body = r.json()
    assert body["merchant"] == "New"
    assert body["amount"] == -10.0


def test_patch_amount_converts_to_cents(alice):
    aid = _acct(alice)
    txn = _txn(alice, aid, amount=-1.0)
    r = alice.put(f"/api/transactions/{txn['id']}", json={"amount": -99.99})
    assert r.json()["amount"] == -99.99


def test_patch_account_id_validates_ownership(alice, bob):
    a_alice = _acct(alice)
    a_bob = _acct(bob)
    txn = _txn(alice, a_alice)
    r = alice.put(f"/api/transactions/{txn['id']}", json={"account_id": a_bob})
    assert r.status_code == 404


def test_patch_empty_body_is_noop(alice):
    aid = _acct(alice)
    txn = _txn(alice, aid)
    r = alice.put(f"/api/transactions/{txn['id']}", json={})
    assert r.status_code == 200
    assert r.json()["id"] == txn["id"]


def test_update_nonexistent_returns_404(alice):
    assert (
        alice.put("/api/transactions/99999", json={"merchant": "X"}).status_code == 404
    )


# ── Delete ───────────────────────────────────────────────────────────────────


def test_delete_transaction(alice):
    aid = _acct(alice)
    txn = _txn(alice, aid)
    r = alice.delete(f"/api/transactions/{txn['id']}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert alice.get("/api/transactions").json() == []


def test_delete_nonexistent_returns_404(alice):
    assert alice.delete("/api/transactions/99999").status_code == 404


def test_deleting_account_cascades_transactions(alice):
    a_keep = _acct(alice, name="Keep")
    a_drop = _acct(alice, name="Drop")
    t_keep = _txn(alice, a_keep, merchant="Keeper")
    _txn(alice, a_drop, merchant="Dropper")
    alice.delete(f"/api/accounts/{a_drop}")
    remaining = alice.get("/api/transactions").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == t_keep["id"]


# ── Validation ───────────────────────────────────────────────────────────────


def test_create_rejects_blank_merchant(alice):
    aid = _acct(alice)
    r = alice.post(
        "/api/transactions",
        json={"account_id": aid, "amount": 10, "merchant": ""},
    )
    assert r.status_code == 400


def test_create_rejects_amount_above_max_money(alice):
    aid = _acct(alice)
    r = alice.post(
        "/api/transactions",
        json={"account_id": aid, "amount": MAX_MONEY + 1, "merchant": "X"},
    )
    assert r.status_code == 400


def test_create_rejects_extra_field(alice):
    aid = _acct(alice)
    r = alice.post(
        "/api/transactions",
        json={
            "account_id": aid,
            "amount": 10,
            "merchant": "X",
            "unknown_field": True,
        },
    )
    assert r.status_code == 400


def test_create_rejects_bad_occurred_at(alice):
    aid = _acct(alice)
    r = alice.post(
        "/api/transactions",
        json={
            "account_id": aid,
            "amount": 10,
            "merchant": "X",
            "occurred_at": "not-a-date",
        },
    )
    assert r.status_code == 400
