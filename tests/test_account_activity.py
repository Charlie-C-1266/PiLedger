"""
Tests for ``GET /api/accounts/{aid}/activity`` — the account page's
"vs 30 days ago" delta and its "Last 30 days · N transactions" line.
"""

from datetime import datetime, timedelta, timezone

import pytest

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"


def _ago(days: float) -> str:
    """A canonical UTC timestamp ``days`` before now."""
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime(ISO_FMT)


def _account(client, name="Everyday", type_="current") -> int:
    resp = client.post("/api/accounts", json={"name": name, "type": type_})
    assert resp.status_code == 201
    return resp.json()["id"]


def _snapshot(client, aid: int, balance: float, days_ago: float) -> None:
    resp = client.post(
        f"/api/accounts/{aid}/balance",
        json={"balance": balance, "recorded_at": _ago(days_ago)},
    )
    assert resp.status_code == 200


def _txn(client, aid: int, amount: float, days_ago: float) -> None:
    resp = client.post(
        "/api/transactions",
        json={
            "account_id": aid,
            "amount": amount,
            "merchant": "Shop",
            "occurred_at": _ago(days_ago),
        },
    )
    assert resp.status_code == 201


# ── Opening balance and change ────────────────────────────────────────────────


def test_opening_balance_is_the_latest_snapshot_before_the_window(alice):
    aid = _account(alice)
    _snapshot(alice, aid, 800.0, days_ago=60)
    _snapshot(alice, aid, 1000.0, days_ago=40)
    _snapshot(alice, aid, 1250.0, days_ago=10)

    body = alice.get(f"/api/accounts/{aid}/activity").json()

    assert body["opening_balance"] == 1000.0
    assert body["change"] == 250.0


def test_change_follows_transactions_posted_since_the_opening(alice):
    aid = _account(alice)
    _snapshot(alice, aid, 1000.0, days_ago=40)
    # Posting a transaction moves the running balance (recorded now).
    _txn(alice, aid, -100.0, days_ago=2)

    body = alice.get(f"/api/accounts/{aid}/activity").json()

    assert body["opening_balance"] == 1000.0
    assert body["change"] == -100.0


def test_no_opening_when_history_starts_inside_the_window(alice):
    aid = _account(alice)
    _snapshot(alice, aid, 500.0, days_ago=5)

    body = alice.get(f"/api/accounts/{aid}/activity").json()

    assert body["opening_balance"] is None
    assert body["change"] is None


def test_account_with_no_history_or_transactions(alice):
    aid = _account(alice)

    body = alice.get(f"/api/accounts/{aid}/activity").json()

    assert body["opening_balance"] is None
    assert body["change"] is None
    assert body["count"] == 0
    assert body["total_in"] == 0.0
    assert body["total_out"] == 0.0


def test_window_boundary_splits_snapshots_by_days(alice):
    aid = _account(alice)
    _snapshot(alice, aid, 100.0, days_ago=31)
    _snapshot(alice, aid, 300.0, days_ago=29)

    # 30 days: the day-31 snapshot is the last one before the window opened.
    thirty = alice.get(f"/api/accounts/{aid}/activity?days=30").json()
    assert thirty["opening_balance"] == 100.0
    assert thirty["change"] == 200.0

    # 28 days: the window opens after the day-29 snapshot, so that's the opening.
    narrow = alice.get(f"/api/accounts/{aid}/activity?days=28").json()
    assert narrow["opening_balance"] == 300.0
    assert narrow["change"] == 0.0


def test_since_is_days_before_now(alice):
    aid = _account(alice)

    body = alice.get(f"/api/accounts/{aid}/activity?days=7").json()

    since = datetime.strptime(body["since"], ISO_FMT).replace(tzinfo=timezone.utc)
    expected = datetime.now(timezone.utc) - timedelta(days=7)
    assert abs((since - expected).total_seconds()) < 60


# ── Count and totals ──────────────────────────────────────────────────────────


def test_counts_and_totals_cover_only_the_window(alice):
    aid = _account(alice)
    _txn(alice, aid, 500.0, days_ago=3)
    _txn(alice, aid, -120.5, days_ago=10)
    _txn(alice, aid, -30.0, days_ago=29)
    # Outside the 30-day window.
    _txn(alice, aid, -999.0, days_ago=31)

    body = alice.get(f"/api/accounts/{aid}/activity").json()

    assert body["count"] == 3
    assert body["total_in"] == 500.0
    # Debits come back as a positive magnitude.
    assert body["total_out"] == 150.5


def test_totals_ignore_other_accounts(alice):
    aid = _account(alice, "Everyday")
    other = _account(alice, "Savings", "savings")
    _txn(alice, aid, -20.0, days_ago=1)
    _txn(alice, other, -75.0, days_ago=1)
    _txn(alice, other, 300.0, days_ago=1)

    body = alice.get(f"/api/accounts/{aid}/activity").json()

    assert body["count"] == 1
    assert body["total_in"] == 0.0
    assert body["total_out"] == 20.0


def test_both_legs_of_a_transfer_count_on_their_own_account(alice):
    src = _account(alice, "Everyday")
    dst = _account(alice, "Savings", "savings")
    resp = alice.post(
        "/api/transfers",
        json={"from_account_id": src, "to_account_id": dst, "amount": 40.0},
    )
    assert resp.status_code == 201

    out_leg = alice.get(f"/api/accounts/{src}/activity").json()
    in_leg = alice.get(f"/api/accounts/{dst}/activity").json()

    assert (out_leg["count"], out_leg["total_out"]) == (1, 40.0)
    assert (in_leg["count"], in_leg["total_in"]) == (1, 40.0)


# ── Isolation, auth and bounds ────────────────────────────────────────────────


def test_another_users_account_is_not_found(alice, bob):
    aid = _account(alice)
    _txn(alice, aid, -10.0, days_ago=1)

    assert bob.get(f"/api/accounts/{aid}/activity").status_code == 404


def test_unknown_account_is_not_found(alice):
    assert alice.get("/api/accounts/99999/activity").status_code == 404


def test_requires_auth(client, alice):
    aid = _account(alice)
    assert client.get(f"/api/accounts/{aid}/activity").status_code == 401


@pytest.mark.parametrize("days", [0, -1, 367])
def test_days_out_of_bounds_is_rejected(alice, days):
    aid = _account(alice)
    assert alice.get(f"/api/accounts/{aid}/activity?days={days}").status_code == 400


@pytest.mark.parametrize("days", [1, 366])
def test_days_at_the_bounds_is_accepted(alice, days):
    aid = _account(alice)
    assert alice.get(f"/api/accounts/{aid}/activity?days={days}").status_code == 200
