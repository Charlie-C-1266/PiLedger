"""
Tests for the three dashboard aggregation endpoints:
  GET /api/summary
  GET /api/history/all
  GET /api/projections
"""

import math

import pytest

from services.projection import monthly_interest_cents


def _with_aer_interest(balance: float, aer: float, months: int) -> float:
    """``balance`` after ``months`` monthly AER credits, each rounded to the
    cent as the projection engine does. Any ``months`` calendar months from
    today hold exactly ``months`` 1sts after today, whatever today is."""
    cents = round(balance * 100)
    for _ in range(months):
        cents += monthly_interest_cents(cents, aer)
    return cents / 100


# ── Summary ───────────────────────────────────────────────────────────────────


def test_summary_empty(alice):
    body = alice.get("/api/summary").json()
    assert body == {
        "total": 0.0,
        "total_current": 0.0,
        "total_savings": 0.0,
        "total_loans": 0.0,
        "total_credit": 0.0,
        "total_invest": 0.0,
        "assets": 0.0,
        "debts": 0.0,
        "savings_rate": 0.0,
        "set_aside": 0.0,
        "total_net_worth": 0.0,
        "account_count": 0,
        "base_currency": "GBP",
        "missing_rates": [],
    }


def test_summary_requires_auth(client):
    assert client.get("/api/summary").status_code == 401


def test_summary_current_accounts(alice):
    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    body = alice.get("/api/summary").json()
    assert body["total_current"] == 1000.0
    assert body["total_savings"] == 0.0
    assert body["total"] == 1000.0
    assert body["account_count"] == 1


def test_summary_savings_accounts(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Marcus", "type": "savings", "interest_rate": 4.0},
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 5000.0})
    body = alice.get("/api/summary").json()
    assert body["total_savings"] == 5000.0
    assert body["total_current"] == 0.0


def test_summary_mixed_accounts(alice):
    c = alice.post("/api/accounts", json={"name": "Current", "type": "current"}).json()[
        "id"
    ]
    s = alice.post("/api/accounts", json={"name": "Savings", "type": "savings"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{c}/balance", json={"balance": 1500.0})
    alice.post(f"/api/accounts/{s}/balance", json={"balance": 3000.0})
    body = alice.get("/api/summary").json()
    assert body["total"] == 4500.0
    assert body["total_current"] == 1500.0
    assert body["total_savings"] == 3000.0
    assert body["account_count"] == 2


def test_summary_account_without_balance_contributes_zero_to_total(alice):
    alice.post("/api/accounts", json={"name": "NoBalance", "type": "current"})
    body = alice.get("/api/summary").json()
    assert body["total"] == 0.0
    assert body["account_count"] == 1  # account is counted even without a balance entry


def test_summary_uses_latest_balance_only(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 100.0})
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 200.0})
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 300.0})
    body = alice.get("/api/summary").json()
    assert body["total_current"] == 300.0  # not 600 (sum) or 100 (first)


def test_summary_user_isolation(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 10_000.0})
    body = bob.get("/api/summary").json()
    assert body["total"] == 0.0
    assert body["account_count"] == 0


def test_summary_loan_subtracted_from_total(alice):
    c = alice.post("/api/accounts", json={"name": "Current", "type": "current"}).json()[
        "id"
    ]
    loan = alice.post(
        "/api/accounts", json={"name": "Car Loan", "type": "loan"}
    ).json()["id"]
    alice.post(f"/api/accounts/{c}/balance", json={"balance": 10000.0})
    alice.post(f"/api/accounts/{loan}/balance", json={"balance": 3000.0})
    body = alice.get("/api/summary").json()
    assert body["assets"] == 10000.0
    assert body["debts"] == 3000.0
    assert body["total"] == 7000.0


def test_summary_negative_loan_balance_treated_as_positive_debt(alice):
    c = alice.post("/api/accounts", json={"name": "Current", "type": "current"}).json()[
        "id"
    ]
    loan = alice.post("/api/accounts", json={"name": "Loan", "type": "loan"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{c}/balance", json={"balance": 5000.0})
    alice.post(f"/api/accounts/{loan}/balance", json={"balance": -2000.0})
    body = alice.get("/api/summary").json()
    assert body["assets"] == 5000.0
    assert body["debts"] == 2000.0
    assert body["total"] == 3000.0


def test_summary_credit_subtracted_from_total(alice):
    c = alice.post("/api/accounts", json={"name": "Current", "type": "current"}).json()[
        "id"
    ]
    cc = alice.post(
        "/api/accounts",
        json={"name": "CC", "type": "credit", "subtype": "credit_card"},
    ).json()["id"]
    alice.post(f"/api/accounts/{c}/balance", json={"balance": 8000.0})
    alice.post(f"/api/accounts/{cc}/balance", json={"balance": 1500.0})
    body = alice.get("/api/summary").json()
    assert body["assets"] == 8000.0
    assert body["debts"] == 1500.0
    assert body["total"] == 6500.0


# ── Accessible net worth (set-aside flag, ADR-0003) ───────────────────────────


def test_summary_account_counts_to_net_worth_by_default(alice):
    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()[
        "id"
    ]
    assert alice.get("/api/accounts").json()[0]["counts_to_net_worth"] is True
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    body = alice.get("/api/summary").json()
    assert body["total"] == 1000.0
    assert body["set_aside"] == 0.0
    assert body["total_net_worth"] == 1000.0


def test_summary_set_aside_asset_excluded_from_headline(alice):
    cur = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    pension = alice.post(
        "/api/accounts",
        json={"name": "Pension", "type": "invest", "counts_to_net_worth": False},
    ).json()["id"]
    alice.post(f"/api/accounts/{cur}/balance", json={"balance": 2000.0})
    alice.post(f"/api/accounts/{pension}/balance", json={"balance": 50_000.0})
    body = alice.get("/api/summary").json()
    # Headline (Accessible) excludes the pension; assets reconcile to it.
    assert body["assets"] == 2000.0
    assert body["total"] == 2000.0
    assert body["total_invest"] == 0.0
    # Set-aside total carries the pension; full picture reconciles.
    assert body["set_aside"] == 50_000.0
    assert body["total_net_worth"] == 52_000.0


def test_summary_set_aside_liability_raises_accessible(alice):
    # Setting aside a liability removes it from the headline, which *raises*
    # Accessible net worth (ADR-0003 consequence) while total_net_worth keeps it.
    cur = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    mortgage = alice.post(
        "/api/accounts",
        json={"name": "Mortgage", "type": "loan", "counts_to_net_worth": False},
    ).json()["id"]
    alice.post(f"/api/accounts/{cur}/balance", json={"balance": 10_000.0})
    alice.post(f"/api/accounts/{mortgage}/balance", json={"balance": 200_000.0})
    body = alice.get("/api/summary").json()
    assert body["debts"] == 0.0
    assert body["total"] == 10_000.0
    assert body["set_aside"] == -200_000.0
    assert body["total_net_worth"] == -190_000.0


def test_summary_flag_toggle_moves_account_between_buckets(alice):
    aid = alice.post("/api/accounts", json={"name": "ISA", "type": "savings"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 8000.0})
    assert alice.get("/api/summary").json()["total"] == 8000.0
    alice.put(f"/api/accounts/{aid}", json={"counts_to_net_worth": False})
    body = alice.get("/api/summary").json()
    assert body["total"] == 0.0
    assert body["set_aside"] == 8000.0
    assert body["total_net_worth"] == 8000.0


def test_summary_savings_rate_ignores_set_aside_savings(alice):
    # savings_rate is Accessible-only: a set-aside savings pot must not inflate
    # it, and its balance must not appear in accessible assets either.
    cur = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    pot = alice.post(
        "/api/accounts",
        json={"name": "ISA", "type": "savings", "counts_to_net_worth": False},
    ).json()["id"]
    alice.post(f"/api/accounts/{cur}/balance", json={"balance": 1000.0})
    alice.post(f"/api/accounts/{pot}/balance", json={"balance": 5000.0})
    body = alice.get("/api/summary").json()
    assert body["assets"] == 1000.0
    assert body["total_savings"] == 0.0
    assert body["savings_rate"] == 0.0


# ── History / all ─────────────────────────────────────────────────────────────


def test_history_all_empty(alice):
    assert alice.get("/api/history/all").json() == []


def test_history_all_requires_auth(client):
    assert client.get("/api/history/all").status_code == 401


def test_history_all_returns_accounts_that_have_entries(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "Monzo", "type": "current", "color": "#f97316"}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    data = alice.get("/api/history/all").json()
    assert len(data) == 1
    assert data[0]["name"] == "Monzo"
    assert data[0]["history"][0]["balance"] == 1000.0


def test_history_all_excludes_accounts_without_entries(alice):
    alice.post("/api/accounts", json={"name": "NoBalance", "type": "current"})
    assert alice.get("/api/history/all").json() == []


def test_history_all_days_filter_excludes_old_entries(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()[
        "id"
    ]
    alice.post(
        f"/api/accounts/{aid}/balance",
        json={
            "balance": 100.0,
            "recorded_at": "2000-01-01T00:00:00Z",
        },
    )
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 200.0})

    data = alice.get("/api/history/all?days=30").json()
    # Account still appears (has a recent entry) but only the recent entry is included
    assert len(data) == 1
    assert len(data[0]["history"]) == 1
    assert data[0]["history"][0]["balance"] == 200.0


def test_history_all_account_absent_when_all_entries_are_old(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()[
        "id"
    ]
    alice.post(
        f"/api/accounts/{aid}/balance",
        json={
            "balance": 100.0,
            "recorded_at": "2000-01-01T00:00:00Z",
        },
    )
    data = alice.get("/api/history/all?days=30").json()
    assert data == []


def test_history_all_user_isolation(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Alice", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    assert bob.get("/api/history/all").json() == []


# ── Projections ───────────────────────────────────────────────────────────────


def test_projections_empty_when_no_savings_accounts(alice):
    alice.post("/api/accounts", json={"name": "Current", "type": "current"})
    assert alice.get("/api/projections").json() == []


def test_projections_requires_auth(client):
    assert client.get("/api/projections").status_code == 401


def test_projections_returns_correct_structure(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Marcus", "type": "savings", "interest_rate": 4.1},
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 8000.0})
    proj = alice.get("/api/projections?months=12").json()[0]
    assert proj["name"] == "Marcus"
    assert proj["initial_balance"] == 8000.0
    assert proj["interest_rate"] == 4.1
    assert "1yr" in proj and "2yr" in proj and "5yr" in proj
    assert "points" in proj


def test_projections_1yr_compound_interest_calculation(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "Saver", "type": "savings", "interest_rate": 4.1}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 8000.0})
    proj = alice.get("/api/projections").json()[0]

    # The rate is an AER: twelve monthly credits compound back up to it.
    assert proj["1yr"] == _with_aer_interest(8000.0, 4.1, 12)
    assert proj["1yr"] == pytest.approx(8000.0 * 1.041, abs=0.05)


def test_projections_5yr_compound_interest_calculation(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "Saver", "type": "savings", "interest_rate": 3.5}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 10_000.0})
    proj = alice.get("/api/projections").json()[0]

    assert proj["5yr"] == _with_aer_interest(10_000.0, 3.5, 60)
    assert proj["5yr"] == pytest.approx(10_000.0 * math.pow(1.035, 5), abs=0.25)


def test_projections_points_length_matches_months_parameter(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "S", "type": "savings", "interest_rate": 5.0}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    for months in (12, 24, 60):
        data = alice.get(f"/api/projections?months={months}").json()
        assert len(data[0]["points"]) == months + 1  # month 0 through month N


def test_projections_first_point_equals_current_balance(alice):
    aid = alice.post(
        "/api/accounts", json={"name": "S", "type": "savings", "interest_rate": 5.0}
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 2500.0})
    proj = alice.get("/api/projections").json()[0]
    assert proj["points"][0]["balance"] == 2500.0


def test_projections_zero_interest_stays_flat(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Flat Saver", "type": "savings", "interest_rate": 0.0},
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 5000.0})
    proj = alice.get("/api/projections?months=24").json()[0]
    assert proj["1yr"] == 5000.0
    assert proj["2yr"] == 5000.0
    assert all(p["balance"] == 5000.0 for p in proj["points"])


def test_projections_no_balance_recorded_uses_zero(alice):
    alice.post(
        "/api/accounts",
        json={"name": "Empty Saver", "type": "savings", "interest_rate": 5.0},
    )
    proj = alice.get("/api/projections").json()[0]
    assert proj["initial_balance"] == 0.0
    assert proj["1yr"] == 0.0


def test_projections_user_isolation(alice, bob):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Alice Saver", "type": "savings", "interest_rate": 4.0},
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 5000.0})
    assert bob.get("/api/projections").json() == []


# ── Projections window parity with the account page ─────────────────────────


def _in_months(n: int):
    from datetime import date

    from services.subscriptions import add_months

    today = date.today()
    return add_months(today.day, today.year, today.month, n)


def _savings_with_schedule(alice) -> tuple[int, int]:
    """A savings account at 3.9% AER fed by a monthly transfer from a current
    account, with a quarterly withdrawal of its own. Returns both ids."""
    from datetime import date, timedelta

    current = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    savings = alice.post(
        "/api/accounts",
        json={"name": "Rainy day", "type": "savings", "interest_rate": 3.9},
    ).json()["id"]
    alice.post(f"/api/accounts/{current}/balance", json={"balance": 2000.0})
    alice.post(f"/api/accounts/{savings}/balance", json={"balance": 4321.09})
    start = date.today() + timedelta(days=2)
    for body in (
        {
            "name": "Save",
            "amount": 250.0,
            "kind": "transfer",
            "account_id": current,
            "to_account_id": savings,
            "frequency": "monthly",
        },
        {
            "name": "Car fund",
            "amount": 400.0,
            "account_id": savings,
            "frequency": "quarterly",
        },
    ):
        resp = alice.post(
            "/api/subscriptions", json={**body, "start_date": start.isoformat()}
        )
        assert resp.status_code == 201, resp.text
    return current, savings


def test_projections_window_matches_the_account_page(alice):
    _, savings = _savings_with_schedule(alice)

    [window] = alice.get("/api/projections?months=60").json()
    page = alice.get(f"/api/accounts/{savings}/projection?months=60").json()
    by_date = {p["date"]: p["balance"] for p in page["points"]}
    horizons = {h["months"]: h["balance"] for h in page["horizons"]}

    assert window["id"] == savings
    assert window["initial_balance"] == page["start_balance"] == 4321.09
    assert window["1yr"] == horizons[12]
    assert window["2yr"] == by_date[_in_months(24).isoformat()]
    assert window["5yr"] == by_date[_in_months(60).isoformat()]
    # Every monthly point after today is that day's closing balance on the page.
    assert len(window["points"]) == 61
    for m, point in enumerate(window["points"][1:], start=1):
        assert point["date"] == _in_months(m).isoformat()
        assert point["balance"] == by_date[point["date"]]
    for months in (1, 3, 6):
        assert window["points"][months]["balance"] == horizons[months]


def test_projections_window_counts_transfers_in_and_aer_interest(alice):
    from datetime import date, timedelta

    current = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    savings = alice.post(
        "/api/accounts", json={"name": "Pot", "type": "savings"}
    ).json()["id"]
    alice.post(f"/api/accounts/{savings}/balance", json={"balance": 1000.0})
    alice.post(
        "/api/subscriptions",
        json={
            "name": "Save",
            "amount": 100.0,
            "kind": "transfer",
            "account_id": current,
            "to_account_id": savings,
            "frequency": "monthly",
            # From tomorrow, any year ahead holds exactly 12 occurrences.
            "start_date": (date.today() + timedelta(days=1)).isoformat(),
        },
    )
    [window] = alice.get("/api/projections").json()
    assert window["1yr"] == 2200.0  # no rate: just the twelve transfers in

    alice.put(f"/api/accounts/{savings}", json={"interest_rate": 5.0})
    [window] = alice.get("/api/projections").json()
    assert window["1yr"] > 2200.0
    page = alice.get(f"/api/accounts/{savings}/projection").json()
    assert window["1yr"] == page["horizons"][-1]["balance"]


def test_projections_window_points_keep_their_monthly_shape(alice):
    _savings_with_schedule(alice)
    [window] = alice.get("/api/projections?months=12").json()
    assert set(window) == {
        "id",
        "name",
        "color",
        "currency",
        "initial_balance",
        "interest_rate",
        "1yr",
        "2yr",
        "5yr",
        "points",
    }
    assert len(window["points"]) == 13
    # Milestones beyond the requested horizon are still worked out.
    assert window["5yr"] > 0
    assert window["points"][0] == {
        "date": _in_months(0).isoformat(),
        "balance": 4321.09,
    }


def test_projections_window_leaves_out_closed_savings(alice):
    aid = alice.post(
        "/api/accounts",
        json={"name": "Old ISA", "type": "savings", "interest_rate": 2.0},
    ).json()["id"]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 500.0})
    assert len(alice.get("/api/projections").json()) == 1

    alice.put(f"/api/accounts/{aid}", json={"closed": True})
    assert alice.get("/api/projections").json() == []


def test_projections_window_ignores_another_users_schedule(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Pot", "type": "savings"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 1000.0})
    bob.post("/api/accounts", json={"name": "Bob pot", "type": "savings"})
    [window] = alice.get("/api/projections").json()
    assert window["1yr"] == 1000.0
    assert [p["name"] for p in bob.get("/api/projections").json()] == ["Bob pot"]


# ── Net-worth history ────────────────────────────────────────────────────────


def test_networth_requires_auth(client):
    assert client.get("/api/history/networth").status_code == 401


def test_networth_empty_no_accounts(alice):
    assert alice.get("/api/history/networth").json() == []


def test_networth_single_account_single_entry(alice):
    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 2500.0})
    points = alice.get("/api/history/networth?range=7D").json()
    assert len(points) == 1
    assert points[0]["value"] == 2500.0


def test_networth_multiple_accounts_same_date(alice):
    a1 = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    a2 = alice.post(
        "/api/accounts", json={"name": "Savings", "type": "savings"}
    ).json()["id"]
    alice.post(f"/api/accounts/{a1}/balance", json={"balance": 1000.0})
    alice.post(f"/api/accounts/{a2}/balance", json={"balance": 3000.0})
    points = alice.get("/api/history/networth?range=30D").json()
    assert len(points) == 1
    assert points[0]["value"] == 4000.0


def test_networth_liabilities_subtracted(alice):
    a1 = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    a2 = alice.post(
        "/api/accounts",
        json={"name": "Credit Card", "type": "credit", "subtype": "credit_card"},
    ).json()["id"]
    alice.post(f"/api/accounts/{a1}/balance", json={"balance": 5000.0})
    alice.post(f"/api/accounts/{a2}/balance", json={"balance": 1200.0})
    points = alice.get("/api/history/networth?range=30D").json()
    assert points[-1]["value"] == 3800.0


def test_networth_negative_debt_balance_matches_summary(alice):
    # A debt recorded as a negative balance (e.g. -2000 = owe 2000) must be
    # subtracted from net worth, exactly as /api/summary treats it. Previously
    # the chart did `nw -= converted`, so a negative balance flipped sign and
    # was added, pushing the chart above the headline net-worth value.
    c = alice.post("/api/accounts", json={"name": "Current", "type": "current"}).json()[
        "id"
    ]
    loan = alice.post("/api/accounts", json={"name": "Loan", "type": "loan"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{c}/balance", json={"balance": 5000.0})
    alice.post(f"/api/accounts/{loan}/balance", json={"balance": -2000.0})

    points = alice.get("/api/history/networth?range=30D").json()
    summary = alice.get("/api/summary").json()
    assert points[-1]["value"] == 3000.0
    assert points[-1]["value"] == summary["total"]


def test_networth_excludes_set_aside_accounts(alice):
    # The trend is the Accessible net-worth line — set-aside accounts drop out
    # retroactively, matching the /api/summary headline (ADR-0003).
    cur = alice.post(
        "/api/accounts", json={"name": "Current", "type": "current"}
    ).json()["id"]
    pension = alice.post(
        "/api/accounts",
        json={"name": "Pension", "type": "invest", "counts_to_net_worth": False},
    ).json()["id"]
    alice.post(f"/api/accounts/{cur}/balance", json={"balance": 3000.0})
    alice.post(f"/api/accounts/{pension}/balance", json={"balance": 40_000.0})
    points = alice.get("/api/history/networth?range=30D").json()
    summary = alice.get("/api/summary").json()
    assert points[-1]["value"] == 3000.0
    assert points[-1]["value"] == summary["total"]


def test_networth_invalid_range_rejected(alice):
    r = alice.get("/api/history/networth?range=2W")
    assert r.status_code == 400


def test_networth_user_isolation(alice, bob):
    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()[
        "id"
    ]
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 9000.0})
    assert bob.get("/api/history/networth").json() == []


def test_networth_carry_forward(alice):
    from datetime import datetime, timedelta, timezone

    aid = alice.post("/api/accounts", json={"name": "Monzo", "type": "current"}).json()[
        "id"
    ]
    old = (datetime.now(timezone.utc) - timedelta(days=20)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    alice.post(
        f"/api/accounts/{aid}/balance",
        json={"balance": 1000.0, "recorded_at": old},
    )
    recent = (datetime.now(timezone.utc) - timedelta(days=2)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    alice.post(
        f"/api/accounts/{aid}/balance",
        json={"balance": 1500.0, "recorded_at": recent},
    )
    points = alice.get("/api/history/networth?range=7D").json()
    assert len(points) == 1
    assert points[0]["value"] == 1500.0


def test_networth_multi_currency(alice):
    alice.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0.80}]})
    gbp = alice.post(
        "/api/accounts", json={"name": "GBP Acc", "type": "current", "currency": "GBP"}
    ).json()["id"]
    usd = alice.post(
        "/api/accounts", json={"name": "USD Acc", "type": "current", "currency": "USD"}
    ).json()["id"]
    alice.post(f"/api/accounts/{gbp}/balance", json={"balance": 1000.0})
    alice.post(f"/api/accounts/{usd}/balance", json={"balance": 500.0})
    points = alice.get("/api/history/networth?range=30D").json()
    assert points[-1]["value"] == 1400.0
