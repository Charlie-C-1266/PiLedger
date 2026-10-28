"""
Tests for account CRUD operations and cross-user isolation.
"""


# ── Listing ────────────────────────────────────────────────────────────────────


def test_list_accounts_empty_for_new_user(alice):
    assert alice.get("/api/accounts").json() == []


def test_list_accounts_requires_auth(client):
    assert client.get("/api/accounts").status_code == 401


def test_list_preserves_creation_order(alice):
    for name in ("First", "Second", "Third"):
        alice.post("/api/accounts", json={"name": name, "type": "current"})
    names = [a["name"] for a in alice.get("/api/accounts").json()]
    assert names == ["First", "Second", "Third"]


# ── Creation ───────────────────────────────────────────────────────────────────


def test_create_current_account(alice):
    resp = alice.post(
        "/api/accounts", json={"name": "Monzo", "type": "current", "color": "#3b82f6"}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Monzo"
    assert body["type"] == "current"
    assert body["interest_rate"] == 0.0
    assert body["color"] == "#3b82f6"
    assert body["current_balance"] is None


def test_create_savings_account_stores_interest_rate(alice):
    resp = alice.post(
        "/api/accounts",
        json={"name": "Marcus", "type": "savings", "interest_rate": 4.5},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["type"] == "savings"
    assert body["interest_rate"] == 4.5


def test_create_account_rejects_invalid_type(alice):
    resp = alice.post("/api/accounts", json={"name": "Bad", "type": "investment"})
    assert resp.status_code == 400


def test_create_account_requires_auth(client):
    resp = client.post("/api/accounts", json={"name": "X", "type": "current"})
    assert resp.status_code == 401


def test_new_account_has_null_balance(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()[
        "id"
    ]
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert acc["current_balance"] is None
    assert acc["last_updated"] is None


# ── Update ─────────────────────────────────────────────────────────────────────


def test_update_account_name(alice):
    aid = alice.post("/api/accounts", json={"name": "Old", "type": "current"}).json()[
        "id"
    ]
    resp = alice.put(f"/api/accounts/{aid}", json={"name": "New"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


def test_update_interest_rate(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "S", "type": "savings", "interest_rate": 3.0}
    ).json()["id"]
    resp = alice.put(f"/api/accounts/{aid}", json={"interest_rate": 4.75})
    assert resp.status_code == 200
    assert resp.json()["interest_rate"] == 4.75


def test_update_colour(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "X", "type": "current", "color": "#000000"}
    ).json()["id"]
    resp = alice.put(f"/api/accounts/{aid}", json={"color": "#ffffff"})
    assert resp.status_code == 200
    assert resp.json()["color"] == "#ffffff"


def test_partial_update_leaves_other_fields_unchanged(alice):
    aid = alice.post(
        "/api/accounts",
        json={
            "name": "Keep",
            "type": "savings",
            "interest_rate": 5.0,
            "color": "#aabbcc",
        },
    ).json()["id"]
    alice.put(f"/api/accounts/{aid}", json={"interest_rate": 6.0})
    body = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert body["name"] == "Keep"
    assert body["color"] == "#aabbcc"
    assert body["interest_rate"] == 6.0


def test_update_nonexistent_account_returns_404(alice):
    assert alice.put("/api/accounts/99999", json={"name": "Ghost"}).status_code == 404


# ── Changing the type and currency ─────────────────────────────────────────────


def _account(client, **fields) -> int:
    return client.post("/api/accounts", json={"name": "A", **fields}).json()["id"]


def _get(client, aid: int) -> dict:
    return next(a for a in client.get("/api/accounts").json() if a["id"] == aid)


def test_update_type_between_accounts_that_hold_money(alice):
    aid = _account(alice, type="current")
    resp = alice.put(
        f"/api/accounts/{aid}", json={"type": "savings", "subtype": "cash_isa"}
    )
    assert resp.status_code == 200
    assert (resp.json()["type"], resp.json()["subtype"]) == ("savings", "cash_isa")


def test_update_type_between_debts(alice):
    aid = _account(alice, type="credit")
    resp = alice.put(
        f"/api/accounts/{aid}", json={"type": "loan", "subtype": "mortgage"}
    )
    assert resp.status_code == 200
    assert (resp.json()["type"], resp.json()["subtype"]) == ("loan", "mortgage")


def test_update_type_refuses_switching_between_held_and_owed(alice):
    """The stored balance means money held on one side and money owed on the
    other, so crossing over would silently flip it."""
    held = _account(alice, type="savings")
    owed = _account(alice, type="loan")
    for aid, new_type in ((held, "credit"), (owed, "current")):
        resp = alice.put(f"/api/accounts/{aid}", json={"type": new_type})
        assert resp.status_code == 400
        assert "money you hold and money you owe" in resp.json()["detail"]
    assert _get(alice, held)["type"] == "savings"
    assert _get(alice, owed)["type"] == "loan"


def test_type_change_checks_the_stored_subtype_against_the_new_type(alice):
    aid = _account(alice, type="savings", subtype="cash_isa")
    # A Cash ISA isn't a kind of current account.
    assert (
        alice.put(f"/api/accounts/{aid}", json={"type": "current"}).status_code == 400
    )
    assert _get(alice, aid)["type"] == "savings"
    # "general" is valid for every type, so it goes through alongside the type.
    resp = alice.put(
        f"/api/accounts/{aid}", json={"type": "current", "subtype": "general"}
    )
    assert resp.status_code == 200


def test_subtype_alone_is_still_checked_against_the_stored_type(alice):
    aid = _account(alice, type="current")
    resp = alice.put(f"/api/accounts/{aid}", json={"subtype": "mortgage"})
    assert resp.status_code == 400


def test_update_currency_relabels_without_converting(alice):
    aid = _account(alice, type="current", currency="GBP")
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 250})
    resp = alice.put(f"/api/accounts/{aid}", json={"currency": "EUR"})
    assert resp.status_code == 200
    body = _get(alice, aid)
    assert (body["currency"], body["current_balance"]) == ("EUR", 250)


def _scheduled(client, **fields) -> None:
    resp = client.post(
        "/api/subscriptions",
        json={
            "name": "Savings pot",
            "amount": 100,
            "frequency": "monthly",
            "start_date": "2026-01-01",
            **fields,
        },
    )
    assert resp.status_code in (200, 201), resp.text


def test_currency_change_refused_while_a_scheduled_transfer_needs_it(alice):
    src = _account(alice, type="current", currency="GBP")
    dst = alice.post(
        "/api/accounts", json={"name": "Pot", "type": "savings", "currency": "GBP"}
    ).json()["id"]
    _scheduled(alice, kind="transfer", account_id=src, to_account_id=dst)
    # Either end of the transfer is held to it.
    for aid in (src, dst):
        resp = alice.put(f"/api/accounts/{aid}", json={"currency": "EUR"})
        assert resp.status_code == 400
        assert '"Savings pot" is a scheduled transfer' in resp.json()["detail"]
        assert _get(alice, aid)["currency"] == "GBP"


def test_currency_change_ignores_scheduled_payments_and_unchanged_currency(alice):
    src = _account(alice, type="current", currency="GBP")
    dst = _account(alice, type="savings", currency="GBP")
    _scheduled(alice, kind="transfer", account_id=src, to_account_id=dst)
    # Re-sending the same currency changes nothing, so it's allowed.
    assert (
        alice.put(f"/api/accounts/{src}", json={"currency": "GBP"}).status_code == 200
    )
    lone = _account(alice, type="current", currency="GBP")
    _scheduled(alice, name="Rent", kind="expense", account_id=lone)
    assert (
        alice.put(f"/api/accounts/{lone}", json={"currency": "EUR"}).status_code == 200
    )


# ── Count-toward-net-worth flag (ADR-0003) ─────────────────────────────────────


def test_create_account_counts_to_net_worth_by_default(alice):
    body = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()
    assert body["counts_to_net_worth"] is True


def test_create_account_can_be_set_aside(alice):
    body = alice.post(
        "/api/accounts",
        json={"name": "Pension", "type": "invest", "counts_to_net_worth": False},
    ).json()
    assert body["counts_to_net_worth"] is False
    # And it round-trips through the list endpoint, not just the create response.
    listed = next(a for a in alice.get("/api/accounts").json() if a["id"] == body["id"])
    assert listed["counts_to_net_worth"] is False


def test_update_counts_to_net_worth_toggles_off_and_on(alice):
    aid = alice.post("/api/accounts", json={"name": "ISA", "type": "savings"}).json()[
        "id"
    ]
    off = alice.put(f"/api/accounts/{aid}", json={"counts_to_net_worth": False})
    assert off.status_code == 200
    assert off.json()["counts_to_net_worth"] is False
    on = alice.put(f"/api/accounts/{aid}", json={"counts_to_net_worth": True})
    assert on.json()["counts_to_net_worth"] is True


def test_partial_update_leaves_counts_to_net_worth_unchanged(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Keep", "type": "invest", "counts_to_net_worth": False},
    ).json()["id"]
    # A patch that omits the flag must not reset it back to the default.
    alice.put(f"/api/accounts/{aid}", json={"color": "#aabbcc"})
    body = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert body["counts_to_net_worth"] is False


def test_update_requires_auth(client, alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()[
        "id"
    ]
    assert (
        client.put(f"/api/accounts/{aid}", json={"name": "Stolen"}).status_code == 401
    )


# ── Closed accounts (#171) ──────────────────────────────────────────────────────


def test_create_account_open_by_default(alice):
    body = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()
    assert body["closed"] is False


def test_create_account_can_be_closed(alice):
    body = alice.post(
        "/api/accounts",
        json={"name": "Old Barclays", "type": "current", "closed": True},
    ).json()
    assert body["closed"] is True
    # And it round-trips through the list endpoint, not just the create response.
    listed = next(a for a in alice.get("/api/accounts").json() if a["id"] == body["id"])
    assert listed["closed"] is True


def test_update_closed_toggles_off_and_on(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "Barclays", "type": "current"}
    ).json()["id"]
    closed = alice.put(f"/api/accounts/{aid}", json={"closed": True})
    assert closed.status_code == 200
    assert closed.json()["closed"] is True
    reopened = alice.put(f"/api/accounts/{aid}", json={"closed": False})
    assert reopened.json()["closed"] is False


def test_partial_update_leaves_closed_unchanged(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Keep", "type": "current", "closed": True},
    ).json()["id"]
    # A patch that omits the flag must not reopen the account.
    alice.put(f"/api/accounts/{aid}", json={"color": "#aabbcc"})
    body = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert body["closed"] is True


# ── Deletion ───────────────────────────────────────────────────────────────────


def test_delete_account(alice):
    aid = alice.post("/api/accounts", json={"name": "Temp", "type": "current"}).json()[
        "id"
    ]
    assert alice.delete(f"/api/accounts/{aid}").status_code == 200
    ids = [a["id"] for a in alice.get("/api/accounts").json()]
    assert aid not in ids


def test_delete_nonexistent_account_returns_404(alice):
    assert alice.delete("/api/accounts/99999").status_code == 404


def test_delete_requires_auth(client, alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()[
        "id"
    ]
    assert client.delete(f"/api/accounts/{aid}").status_code == 401


# ── Cross-user isolation ───────────────────────────────────────────────────────


def test_user_cannot_see_another_users_accounts(alice, bob):
    alice.post("/api/accounts", json={"name": "Alice Account", "type": "current"})
    assert bob.get("/api/accounts").json() == []


def test_user_cannot_update_another_users_account(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()[
        "id"
    ]
    assert bob.put(f"/api/accounts/{aid}", json={"name": "Hacked"}).status_code == 404
    # Verify alice's data is unchanged
    account = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert account["name"] == "Alice"


def test_user_cannot_delete_another_users_account(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()[
        "id"
    ]
    assert bob.delete(f"/api/accounts/{aid}").status_code == 404
    # Account still exists for alice
    assert any(a["id"] == aid for a in alice.get("/api/accounts").json())
