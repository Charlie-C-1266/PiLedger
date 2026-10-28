"""Balance adjustments: a manual balance update (`POST /api/accounts/{aid}/balance`)
also records the difference it made as a "Balance adjustment" transaction, so
the change shows in the account's history.

The row is a record, not a cash flow: it doesn't move the balance a second
time, isn't counted as spending or money in/out, and its amount and account
can't be edited. Deleting it reverses it like any other transaction.
"""

from db import db


def _account(client, type_: str = "current", name: str = "Main") -> int:
    return client.post("/api/accounts", json={"name": name, "type": type_}).json()["id"]


def _set_balance(client, aid: int, balance: float, **extra) -> None:
    r = client.post(f"/api/accounts/{aid}/balance", json={"balance": balance, **extra})
    assert r.status_code == 200, r.text


def _balance(client, aid: int) -> float:
    acct = next(a for a in client.get("/api/accounts").json() if a["id"] == aid)
    return acct["current_balance"]


def _txns(client, aid: int) -> list[dict]:
    return client.get(f"/api/transactions?account={aid}").json()


def _adjustments(client, aid: int) -> list[dict]:
    return [t for t in _txns(client, aid) if t["adjustment"]]


# ── Recording ─────────────────────────────────────────────────────────────────


def test_first_balance_records_no_adjustment(alice):
    """An account's first balance is its starting point, not a change."""
    aid = _account(alice)
    _set_balance(alice, aid, 1240.00)
    assert _txns(alice, aid) == []
    assert _balance(alice, aid) == 1240.00


def test_a_changed_balance_records_the_difference(alice):
    aid = _account(alice)
    _set_balance(alice, aid, 1240.00)
    _set_balance(alice, aid, 1252.40, notes="Matched the bank app")

    [adj] = _adjustments(alice, aid)
    assert adj["amount"] == 12.40
    assert adj["merchant"] == "Balance adjustment"
    assert adj["category"] == "Adjustment"
    assert adj["note"] == "Matched the bank app"
    assert adj["transfer_id"] is None
    assert adj["subscription_id"] is None
    # The row only records the change: the balance is what was entered, not
    # moved again by the adjustment's amount.
    assert _balance(alice, aid) == 1252.40


def test_a_lower_balance_records_money_out(alice):
    aid = _account(alice)
    _set_balance(alice, aid, 500.00)
    _set_balance(alice, aid, 480.25)
    [adj] = _adjustments(alice, aid)
    assert adj["amount"] == -19.75
    assert _balance(alice, aid) == 480.25


def test_an_unchanged_balance_records_nothing(alice):
    aid = _account(alice)
    _set_balance(alice, aid, 300.00)
    _set_balance(alice, aid, 300.00)
    assert _txns(alice, aid) == []


def test_debt_accounts_flip_the_sign(alice):
    """A card stores what's owed: owing more reads as money out, owing less
    as money in, matching how its other transactions are signed."""
    aid = _account(alice, "credit", "Card")
    _set_balance(alice, aid, 500.00)
    _set_balance(alice, aid, 600.00)
    _set_balance(alice, aid, 450.00)
    amounts = sorted(t["amount"] for t in _adjustments(alice, aid))
    assert amounts == [-100.00, 150.00]
    assert _balance(alice, aid) == 450.00


def test_a_backdated_update_compares_with_the_balance_on_that_date(alice):
    aid = _account(alice)
    _set_balance(alice, aid, 1000.00, recorded_at="2026-01-01T09:00:00Z")
    _set_balance(alice, aid, 1200.00, recorded_at="2026-03-01T09:00:00Z")
    _set_balance(alice, aid, 1100.00, recorded_at="2026-02-01T12:00:00Z")

    by_date = {t["occurred_at"][:10]: t["amount"] for t in _adjustments(alice, aid)}
    # Feb: 1000 → 1100 (against January's balance, not March's).
    assert by_date == {"2026-03-01": 200.00, "2026-02-01": 100.00}
    # The latest entry (March) is still the current balance.
    assert _balance(alice, aid) == 1200.00


def test_a_date_before_the_first_balance_records_nothing(alice):
    aid = _account(alice)
    _set_balance(alice, aid, 1000.00, recorded_at="2026-03-01T09:00:00Z")
    _set_balance(alice, aid, 900.00, recorded_at="2026-01-01T09:00:00Z")
    assert _adjustments(alice, aid) == []


def test_ordinary_transactions_are_not_adjustments(alice):
    aid = _account(alice)
    alice.post(
        "/api/transactions",
        json={"account_id": aid, "amount": -42.5, "merchant": "Tesco"},
    )
    [txn] = _txns(alice, aid)
    assert txn["adjustment"] is False


def test_adjustments_belong_to_the_account_owner(alice, bob):
    aid = _account(alice)
    _set_balance(alice, aid, 100.00)
    assert (
        bob.post(f"/api/accounts/{aid}/balance", json={"balance": 5}).status_code == 404
    )
    _set_balance(alice, aid, 150.00)
    assert bob.get("/api/transactions").json() == []
    assert len(_adjustments(alice, aid)) == 1


# ── Editing and deleting ──────────────────────────────────────────────────────


def _one_adjustment(client) -> tuple[int, dict]:
    aid = _account(client)
    _set_balance(client, aid, 1000.00)
    _set_balance(client, aid, 1100.00)
    [adj] = _adjustments(client, aid)
    return aid, adj


def test_deleting_an_adjustment_moves_the_balance_back(alice):
    aid, adj = _one_adjustment(alice)
    assert alice.delete(f"/api/transactions/{adj['id']}").status_code == 200
    assert _balance(alice, aid) == 1000.00
    assert _txns(alice, aid) == []


def test_an_adjustments_amount_cant_be_edited(alice):
    aid, adj = _one_adjustment(alice)
    r = alice.put(f"/api/transactions/{adj['id']}", json={"amount": 250.0})
    assert r.status_code == 400
    assert "update the balance" in r.json()["detail"]
    assert _balance(alice, aid) == 1100.00


def test_an_adjustment_cant_move_to_another_account(alice):
    aid, adj = _one_adjustment(alice)
    other = _account(alice, name="Other")
    r = alice.put(f"/api/transactions/{adj['id']}", json={"account_id": other})
    assert r.status_code == 400
    assert _adjustments(alice, aid)[0]["account_id"] == aid


def test_an_adjustments_note_can_be_edited(alice):
    """The edit form resends the current amount and account; that isn't a
    change, so the note still saves and the balance stays put."""
    aid, adj = _one_adjustment(alice)
    r = alice.put(
        f"/api/transactions/{adj['id']}",
        json={"account_id": aid, "amount": 100.0, "note": "Interest I'd missed"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["note"] == "Interest I'd missed"
    assert body["amount"] == 100.0
    assert body["adjustment"] is True
    assert _balance(alice, aid) == 1100.00


# ── Not money in or out ───────────────────────────────────────────────────────


def test_activity_counts_adjustments_but_not_in_their_totals(alice):
    aid = _account(alice)
    _set_balance(alice, aid, 1000.00)
    _set_balance(alice, aid, 1100.00)  # +100 adjustment
    _set_balance(alice, aid, 1050.00)  # −50 adjustment
    alice.post(
        "/api/transactions",
        json={"account_id": aid, "amount": -20.0, "merchant": "Tesco"},
    )
    body = alice.get(f"/api/accounts/{aid}/activity").json()
    assert body["count"] == 3
    assert body["total_in"] == 0.0
    assert body["total_out"] == 20.0


def test_budget_spend_ignores_adjustments(alice):
    """Even with an envelope on the adjustment's own category, a downward
    correction isn't spending."""
    uid = alice.get("/api/auth/me").json()["id"]
    with db() as conn:
        gid = conn.execute(
            "INSERT INTO budget_group(user_id, name, color, flexible, sort_order)"
            " VALUES(?, 'Everyday', '#D97757', 1, 0)",
            (uid,),
        ).lastrowid
        conn.execute(
            "INSERT INTO budget_envelope(user_id, group_id, label, category,"
            " budgeted_cents, sort_order) VALUES(?, ?, 'Fixes', 'Adjustment', 5000, 0)",
            (uid, gid),
        )
        conn.commit()
    aid = _account(alice)
    _set_balance(alice, aid, 1000.00)
    _set_balance(alice, aid, 900.00)
    assert len(_adjustments(alice, aid)) == 1
    env = alice.get("/api/budget").json()["groups"][0]["envelopes"][0]
    assert env["spent"] == 0.0
