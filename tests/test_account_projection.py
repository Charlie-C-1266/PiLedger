"""
Tests for ``GET /api/accounts/{aid}/projection`` — the account page's horizon
tiles, projection chart, Upcoming list and low-balance note in one response.

The maths is pinned with fixed dates in ``test_projection_service.py``; these
cover the wiring: which rows are loaded, the response shape, bounds and
ownership. The server projects from the real today, so dates here are relative.
"""

from datetime import date, timedelta

import pytest

from services.subscriptions import add_months


def _account(client, name="Household", type_="current", **extra) -> int:
    resp = client.post("/api/accounts", json={"name": name, "type": type_, **extra})
    assert resp.status_code == 201
    return resp.json()["id"]


def _balance(client, aid: int, balance: float) -> None:
    resp = client.post(f"/api/accounts/{aid}/balance", json={"balance": balance})
    assert resp.status_code == 200


def _scheduled(client, **body) -> int:
    payload = {"name": "Phone", "amount": 20.0, "frequency": "monthly"}
    payload.update(body)
    resp = client.post("/api/subscriptions", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _in_months(n: int) -> date:
    today = date.today()
    return add_months(today.day, today.year, today.month, n)


def test_response_shape(alice):
    aid = _account(alice, currency="EUR")
    _balance(alice, aid, 1000.0)
    today = date.today()
    sid = _scheduled(
        alice,
        account_id=aid,
        start_date=today.isoformat(),
        category="Bills",
    )

    resp = alice.get(f"/api/accounts/{aid}/projection")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {
        "account_id",
        "currency",
        "as_of",
        "start_balance",
        "points",
        "horizons",
        "events",
        "summary",
    }
    assert body["account_id"] == aid
    assert body["currency"] == "EUR"
    assert body["as_of"] == today.isoformat()
    assert body["start_balance"] == 1000.0

    # One closing balance per day from today to 12 months on; today's
    # occurrence is already in today's close.
    points = body["points"]
    assert len(points) == (_in_months(12) - today).days + 1
    assert points[0] == {"date": today.isoformat(), "balance": 980.0}
    assert points[-1]["date"] == _in_months(12).isoformat()

    assert [h["months"] for h in body["horizons"]] == [1, 3, 6, 12]
    assert body["horizons"][0]["date"] == _in_months(1).isoformat()

    first = body["events"][0]
    assert first == {
        "date": today.isoformat(),
        "subscription_id": sid,
        "name": "Phone",
        "kind": "expense",
        "frequency": "monthly",
        "category": "Bills",
        "counterparty_name": None,
        "amount": -20.0,
        "auto_post": False,
        "balance_after": 980.0,
    }
    # Today plus one a month for the next 12 months.
    assert len(body["events"]) == 13

    summary = body["summary"]
    assert summary["end_balance"] == 1000.0 - 13 * 20.0
    assert summary["min_balance"] == summary["end_balance"]
    assert summary["first_negative_date"] is None


def test_transfer_shows_the_other_account_on_both_sides(alice):
    household = _account(alice, "Household")
    rainy = _account(alice, "Rainy day", "savings")
    start = (date.today() + timedelta(days=3)).isoformat()
    _scheduled(
        alice,
        name="Top-up",
        kind="transfer",
        amount=250.0,
        account_id=household,
        to_account_id=rainy,
        start_date=start,
    )

    out = alice.get(f"/api/accounts/{household}/projection?months=1").json()
    into = alice.get(f"/api/accounts/{rainy}/projection?months=1").json()

    assert (out["events"][0]["amount"], out["events"][0]["counterparty_name"]) == (
        -250.0,
        "Rainy day",
    )
    assert (into["events"][0]["amount"], into["events"][0]["counterparty_name"]) == (
        250.0,
        "Household",
    )


def test_only_active_items_on_this_account_count(alice):
    aid = _account(alice)
    other = _account(alice, "Other")
    start = date.today().isoformat()
    _scheduled(alice, account_id=aid, start_date=start, active=False)
    _scheduled(alice, account_id=other, start_date=start)
    _scheduled(alice, start_date=start)  # not linked to any account

    body = alice.get(f"/api/accounts/{aid}/projection").json()

    assert body["events"] == []


def test_savings_interest_and_overdraft_note(alice):
    savings = _account(alice, "Saver", "savings", interest_rate=4.0)
    _balance(alice, savings, 5000.0)
    current = _account(alice, "Everyday")
    _balance(alice, current, 50.0)
    soon = date.today() + timedelta(days=2)
    _scheduled(
        alice,
        account_id=current,
        amount=80.0,
        frequency="annual",
        start_date=soon.isoformat(),
    )

    saver = alice.get(f"/api/accounts/{savings}/projection").json()
    everyday = alice.get(f"/api/accounts/{current}/projection").json()

    interest = [e for e in saver["events"] if e["kind"] == "interest"]
    assert len(interest) == 12
    assert all(e["date"].endswith("-01") for e in interest)
    assert all(e["subscription_id"] is None for e in interest)
    assert everyday["summary"]["first_negative_date"] == soon.isoformat()
    assert everyday["summary"]["min_balance"] == -30.0


def test_no_balance_history_starts_from_zero(alice):
    aid = _account(alice)

    body = alice.get(f"/api/accounts/{aid}/projection").json()

    assert body["start_balance"] == 0.0
    assert body["summary"]["end_balance"] == 0.0


def test_closed_accounts_still_answer(alice):
    aid = _account(alice)
    _balance(alice, aid, 10.0)
    assert alice.put(f"/api/accounts/{aid}", json={"closed": True}).status_code == 200

    resp = alice.get(f"/api/accounts/{aid}/projection")

    assert resp.status_code == 200
    assert resp.json()["start_balance"] == 10.0


@pytest.mark.parametrize("months", [1, 60])
def test_months_bounds_are_accepted(alice, months):
    aid = _account(alice)

    resp = alice.get(f"/api/accounts/{aid}/projection?months={months}")

    assert resp.status_code == 200
    assert resp.json()["points"][-1]["date"] == _in_months(months).isoformat()


def test_short_window_reports_only_the_horizons_inside_it(alice):
    aid = _account(alice)
    body = alice.get(f"/api/accounts/{aid}/projection?months=3").json()
    assert [h["months"] for h in body["horizons"]] == [1, 3]


@pytest.mark.parametrize("months", ["0", "61", "-1", "abc"])
def test_months_out_of_bounds_is_rejected(alice, months):
    aid = _account(alice)

    resp = alice.get(f"/api/accounts/{aid}/projection?months={months}")

    assert resp.status_code == 400


def test_another_users_account_is_not_found(alice, bob):
    aid = _account(alice)
    _balance(alice, aid, 1000.0)

    assert bob.get(f"/api/accounts/{aid}/projection").status_code == 404
    assert alice.get("/api/accounts/999999/projection").status_code == 404


def test_requires_auth(client):
    assert client.get("/api/accounts/1/projection").status_code == 401
