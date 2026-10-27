"""
Tests for the per-account "Warn me below" threshold and the ``low_balance``
flag ``GET /api/accounts`` computes from it.

An open asset account is low when its projected closing balance over today
and the next 30 days falls below its threshold (zero when unset). The
projection maths is pinned in ``test_projection_service.py``; these cover the
wiring: validation, what the list reports and when, and per-user isolation.
The server projects from the real today, so dates here are relative.
"""

from datetime import date, timedelta

import pytest


def _account(client, name="Everyday", type_="current", **extra) -> int:
    resp = client.post("/api/accounts", json={"name": name, "type": type_, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _balance(client, aid: int, balance: float) -> None:
    resp = client.post(f"/api/accounts/{aid}/balance", json={"balance": balance})
    assert resp.status_code == 200


def _scheduled(client, aid: int, amount: float, in_days: int, **body) -> int:
    """A monthly expense on ``aid`` whose first occurrence is ``in_days`` away."""
    payload = {
        "name": "Rent",
        "amount": amount,
        "frequency": "monthly",
        "account_id": aid,
        "start_date": (date.today() + timedelta(days=in_days)).isoformat(),
    }
    payload.update(body)
    resp = client.post("/api/subscriptions", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _listed(client, aid: int) -> dict:
    return next(a for a in client.get("/api/accounts").json() if a["id"] == aid)


def _in(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


# ── Threshold validation ─────────────────────────────────────────────────────


def test_threshold_is_unset_by_default(alice):
    aid = _account(alice)
    assert _listed(alice, aid)["low_balance_threshold"] is None


@pytest.mark.parametrize("type_", ["current", "savings", "invest"])
def test_asset_accounts_take_a_threshold_on_create(alice, type_):
    resp = alice.post(
        "/api/accounts",
        json={"name": "A", "type": type_, "low_balance_threshold": 200},
    )
    assert resp.status_code == 201
    assert resp.json()["low_balance_threshold"] == 200.0
    assert _listed(alice, resp.json()["id"])["low_balance_threshold"] == 200.0


@pytest.mark.parametrize("type_", ["credit", "loan"])
def test_debt_accounts_reject_a_threshold_on_create(alice, type_):
    resp = alice.post(
        "/api/accounts",
        json={"name": "Debt", "type": type_, "low_balance_threshold": 200},
    )
    assert resp.status_code == 400
    assert alice.get("/api/accounts").json() == []


@pytest.mark.parametrize("type_", ["credit", "loan"])
def test_debt_accounts_reject_a_threshold_on_update(alice, type_):
    aid = _account(alice, type_=type_)
    resp = alice.put(f"/api/accounts/{aid}", json={"low_balance_threshold": 50})
    assert resp.status_code == 400
    assert _listed(alice, aid)["low_balance_threshold"] is None


def test_debt_accounts_accept_an_explicit_null(alice):
    aid = _account(alice, type_="credit")
    resp = alice.put(f"/api/accounts/{aid}", json={"low_balance_threshold": None})
    assert resp.status_code == 200
    assert resp.json()["low_balance_threshold"] is None


def test_negative_threshold_is_rejected(alice):
    assert (
        alice.post(
            "/api/accounts",
            json={"name": "A", "type": "current", "low_balance_threshold": -1},
        ).status_code
        == 400
    )
    aid = _account(alice)
    resp = alice.put(f"/api/accounts/{aid}", json={"low_balance_threshold": -0.01})
    assert resp.status_code == 400


def test_threshold_can_be_set_kept_and_cleared(alice):
    aid = _account(alice)

    resp = alice.put(f"/api/accounts/{aid}", json={"low_balance_threshold": 250.5})
    assert resp.status_code == 200
    assert resp.json()["low_balance_threshold"] == 250.5

    # A patch that leaves it out leaves it alone…
    alice.put(f"/api/accounts/{aid}", json={"color": "#112233"})
    assert _listed(alice, aid)["low_balance_threshold"] == 250.5

    # …and an explicit null clears it back to "warn below zero".
    resp = alice.put(f"/api/accounts/{aid}", json={"low_balance_threshold": None})
    assert resp.status_code == 200
    assert resp.json()["low_balance_threshold"] is None
    assert _listed(alice, aid)["low_balance_threshold"] is None


def test_zero_threshold_is_stored_as_zero_not_unset(alice):
    aid = _account(alice, low_balance_threshold=0)
    assert _listed(alice, aid)["low_balance_threshold"] == 0.0


def test_another_users_account_threshold_is_404(alice, bob):
    aid = _account(alice)
    resp = bob.put(f"/api/accounts/{aid}", json={"low_balance_threshold": 10})
    assert resp.status_code == 404
    assert _listed(alice, aid)["low_balance_threshold"] is None


# ── low_balance on GET /api/accounts ─────────────────────────────────────────


def test_no_flag_while_the_balance_stays_above_zero(alice):
    aid = _account(alice)
    _balance(alice, aid, 500)
    _scheduled(alice, aid, 400, in_days=10)
    assert _listed(alice, aid)["low_balance"] is None


def test_flags_the_first_day_projected_below_zero(alice):
    aid = _account(alice)
    _balance(alice, aid, 500)
    _scheduled(alice, aid, 600, in_days=10)
    assert _listed(alice, aid)["low_balance"] == {"date": _in(10), "balance": -100.0}


def test_landing_exactly_on_zero_is_not_low(alice):
    aid = _account(alice)
    _balance(alice, aid, 500)
    _scheduled(alice, aid, 500, in_days=10)
    assert _listed(alice, aid)["low_balance"] is None


def test_one_penny_under_zero_is_low(alice):
    aid = _account(alice)
    _balance(alice, aid, 500)
    _scheduled(alice, aid, 500.01, in_days=10)
    assert _listed(alice, aid)["low_balance"] == {"date": _in(10), "balance": -0.01}


def test_flags_the_first_day_below_the_threshold(alice):
    aid = _account(alice, low_balance_threshold=200)
    _balance(alice, aid, 500)
    _scheduled(alice, aid, 150, in_days=5, name="Phone")
    _scheduled(alice, aid, 200, in_days=12, name="Rent")
    # 500 → 350 on day 5 (still above 200) → 150 on day 12.
    assert _listed(alice, aid)["low_balance"] == {"date": _in(12), "balance": 150.0}


def test_landing_exactly_on_the_threshold_is_not_low(alice):
    aid = _account(alice, low_balance_threshold=100)
    _balance(alice, aid, 500)
    _scheduled(alice, aid, 400, in_days=10)
    assert _listed(alice, aid)["low_balance"] is None


def test_raising_the_threshold_turns_the_flag_on(alice):
    aid = _account(alice)
    _balance(alice, aid, 500)
    _scheduled(alice, aid, 400, in_days=10)
    assert _listed(alice, aid)["low_balance"] is None

    alice.put(f"/api/accounts/{aid}", json={"low_balance_threshold": 100.01})
    assert _listed(alice, aid)["low_balance"] == {"date": _in(10), "balance": 100.0}

    alice.put(f"/api/accounts/{aid}", json={"low_balance_threshold": None})
    assert _listed(alice, aid)["low_balance"] is None


def test_already_under_the_threshold_is_low_from_today(alice):
    aid = _account(alice, low_balance_threshold=1000)
    _balance(alice, aid, 500)
    assert _listed(alice, aid)["low_balance"] == {"date": _in(0), "balance": 500.0}


def test_an_account_with_no_balance_yet_is_judged_from_zero(alice):
    quiet = _account(alice, name="Quiet")
    buffered = _account(alice, name="Buffered", low_balance_threshold=50)
    assert _listed(alice, quiet)["low_balance"] is None
    assert _listed(alice, buffered)["low_balance"] == {"date": _in(0), "balance": 0.0}


def test_looks_thirty_days_ahead_and_no_further(alice):
    inside = _account(alice, name="Inside")
    outside = _account(alice, name="Outside")
    for aid in (inside, outside):
        _balance(alice, aid, 100)
    _scheduled(alice, inside, 200, in_days=30)
    _scheduled(alice, outside, 200, in_days=31)

    assert _listed(alice, inside)["low_balance"] == {"date": _in(30), "balance": -100.0}
    assert _listed(alice, outside)["low_balance"] is None


def test_counts_transfers_out_and_in(alice):
    current = _account(alice, name="Current")
    savings = _account(alice, name="Savings", type_="savings", low_balance_threshold=50)
    _balance(alice, current, 100)
    _balance(alice, savings, 100)
    # £150 leaves Current for Savings on day 3, and £80 comes back on day 4.
    _scheduled(alice, current, 150, in_days=3, kind="transfer", to_account_id=savings)
    _scheduled(alice, savings, 80, in_days=4, kind="transfer", to_account_id=current)

    assert _listed(alice, current)["low_balance"] == {"date": _in(3), "balance": -50.0}
    # Savings: 100 → 250 → 170, never under its £50.
    assert _listed(alice, savings)["low_balance"] is None


def test_skipped_occurrences_dont_count(alice):
    aid = _account(alice)
    _balance(alice, aid, 100)
    sid = _scheduled(alice, aid, 300, in_days=7)
    assert _listed(alice, aid)["low_balance"] is not None

    resp = alice.post(f"/api/subscriptions/{sid}/skip", json={"date": _in(7)})
    assert resp.status_code == 200, resp.text
    assert _listed(alice, aid)["low_balance"] is None


def test_paused_items_dont_count(alice):
    aid = _account(alice)
    _balance(alice, aid, 100)
    sid = _scheduled(alice, aid, 300, in_days=7)
    alice.put(f"/api/subscriptions/{sid}", json={"active": False})
    assert _listed(alice, aid)["low_balance"] is None


@pytest.mark.parametrize("type_", ["credit", "loan"])
def test_debt_accounts_are_never_flagged(alice, type_):
    aid = _account(alice, type_=type_)
    _balance(alice, aid, 100)
    _scheduled(alice, aid, 5000, in_days=3)
    assert _listed(alice, aid)["low_balance"] is None


def test_closed_accounts_are_never_flagged(alice):
    aid = _account(alice, low_balance_threshold=1000)
    _balance(alice, aid, 10)
    alice.put(f"/api/accounts/{aid}", json={"closed": True})
    assert _listed(alice, aid)["low_balance"] is None


def test_create_and_update_responses_leave_the_flag_to_the_list(alice):
    """Like ``current_balance``, the flag is only worked out for the list."""
    resp = alice.post(
        "/api/accounts",
        json={"name": "A", "type": "current", "low_balance_threshold": 10},
    )
    assert resp.json()["low_balance"] is None
    resp = alice.put(
        f"/api/accounts/{resp.json()['id']}", json={"low_balance_threshold": 20}
    )
    assert resp.json()["low_balance"] is None


# ── Per-user isolation ───────────────────────────────────────────────────────


def test_another_users_schedule_never_moves_your_flag(alice, bob):
    """Bob's scheduled items can't reach Alice's accounts — not even a row that
    names her account directly, which the API would never let him create."""
    aid = _account(alice)
    _balance(alice, aid, 100)
    bob_aid = _account(bob, name="Bob's")
    bob_uid = _listed(bob, bob_aid)["user_id"]

    from db import db

    with db() as conn:
        conn.execute(
            "INSERT INTO subscriptions(user_id, name, amount_cents, account_id,"
            " frequency, start_date) VALUES(?, 'Sneaky', 50000, ?, 'monthly', ?)",
            (bob_uid, aid, _in(2)),
        )
        conn.commit()

    assert _listed(alice, aid)["low_balance"] is None
    assert [a["id"] for a in bob.get("/api/accounts").json()] == [bob_aid]


def test_each_user_sees_only_their_own_flags(alice, bob):
    alice_aid = _account(alice)
    _balance(alice, alice_aid, 100)
    _scheduled(alice, alice_aid, 300, in_days=4)
    bob_aid = _account(bob)
    _balance(bob, bob_aid, 100)

    assert _listed(alice, alice_aid)["low_balance"] == {
        "date": _in(4),
        "balance": -200.0,
    }
    bob_accounts = bob.get("/api/accounts").json()
    assert [a["id"] for a in bob_accounts] == [bob_aid]
    assert bob_accounts[0]["low_balance"] is None
