"""Pure tests for services/projection — no DB, no HTTP.

Fixed dates throughout, so month ends, the 1st-of-month interest and the
horizon clamping are pinned rather than depending on when the suite runs.
"""

from datetime import date, timedelta

import pytest

from services.accounts import balance_delta
from services.projection import (
    LOW_BALANCE_DAYS,
    Point,
    ScheduledItem,
    first_below,
    monthly_interest_cents,
    monthly_points,
    project,
)

TODAY = date(2026, 10, 26)
ACCOUNT = 1
OTHER = 2


def _item(**overrides) -> ScheduledItem:
    """A monthly £10 expense on ACCOUNT starting today, with overrides."""
    fields = dict(
        id=10,
        name="Phone",
        kind="expense",
        frequency="monthly",
        category="Bills",
        amount_cents=1000,
        start_date=TODAY,
        end_date=None,
        account_id=ACCOUNT,
        to_account_id=None,
    )
    fields.update(overrides)
    return ScheduledItem(**fields)


def _project(items=(), **overrides):
    kwargs = dict(
        account_id=ACCOUNT,
        account_type="current",
        interest_rate=0.0,
        start_balance_cents=100_000,
        items=items,
        today=TODAY,
        months=12,
    )
    kwargs.update(overrides)
    return project(**kwargs)


def _balance_on(result, day: date) -> int:
    return next(p.balance_cents for p in result.points if p.date == day)


# ── Flat line ────────────────────────────────────────────────────────────────


def test_no_events_gives_a_flat_line():
    result = _project()

    assert result.events == []
    assert result.points[0].date == TODAY
    assert result.points[-1].date == date(2027, 10, 26)
    assert len(result.points) == 366
    assert {p.balance_cents for p in result.points} == {100_000}
    assert [h.change_cents for h in result.horizons] == [0, 0, 0, 0]
    assert result.summary.min_balance_cents == 100_000
    assert result.summary.min_date == TODAY
    assert result.summary.first_negative_date is None
    assert result.summary.end_balance_cents == 100_000


# ── Scheduled items ──────────────────────────────────────────────────────────


def test_weekly_outflow_steps_the_balance_down():
    shop = _item(
        name="Food shop",
        frequency="weekly",
        amount_cents=9_500,
        start_date=TODAY + timedelta(days=2),
    )

    result = _project([shop], months=1)

    dates = [e.date for e in result.events]
    assert dates == [date(2026, 10, 28) + timedelta(weeks=n) for n in range(5)]
    assert [e.amount_cents for e in result.events] == [-9_500] * 5
    assert [e.balance_after_cents for e in result.events] == [
        100_000 - 9_500 * n for n in range(1, 6)
    ]
    # The day before the first shop is untouched; the day itself closes lower.
    assert _balance_on(result, date(2026, 10, 27)) == 100_000
    assert _balance_on(result, date(2026, 10, 28)) == 90_500
    first = result.events[0]
    assert (first.subscription_id, first.kind, first.frequency) == (
        10,
        "expense",
        "weekly",
    )
    assert first.category == "Bills"
    assert first.counterparty_name is None


def test_occurrence_due_today_is_included():
    result = _project([_item()], months=1)

    assert result.events[0].date == TODAY
    assert result.points[0].balance_cents == 99_000
    # The start balance is the snapshot the occurrence hasn't touched yet.
    assert result.start_balance_cents == 100_000


def test_same_day_income_lands_before_expense():
    day = date(2026, 11, 1)
    rent = _item(id=1, name="Rent", amount_cents=150_000, start_date=day)
    salary = _item(
        id=2, name="Salary", kind="income", amount_cents=250_000, start_date=day
    )

    result = _project([rent, salary], months=1)

    assert [e.name for e in result.events] == ["Salary", "Rent"]
    assert [e.amount_cents for e in result.events] == [250_000, -150_000]
    assert [e.balance_after_cents for e in result.events] == [350_000, 200_000]
    assert _balance_on(result, day) == 200_000


def test_transfer_from_both_sides():
    transfer = _item(
        name="Savings top-up",
        kind="transfer",
        amount_cents=25_000,
        start_date=date(2026, 11, 17),
        account_id=ACCOUNT,
        to_account_id=OTHER,
        account_name="Household",
        to_account_name="Rainy day",
    )

    source = _project([transfer], account_id=ACCOUNT, months=1)
    destination = _project(
        [transfer], account_id=OTHER, account_type="savings", months=1
    )

    (out,) = source.events
    assert (out.amount_cents, out.counterparty_name) == (-25_000, "Rainy day")
    assert out.balance_after_cents == 75_000
    (into,) = destination.events
    assert (into.amount_cents, into.counterparty_name) == (25_000, "Household")
    assert into.balance_after_cents == 125_000
    assert into.kind == "transfer"


def test_items_not_touching_the_account_are_ignored():
    elsewhere = _item(account_id=OTHER)
    unlinked = _item(id=11, account_id=None)
    other_transfer = _item(id=12, kind="transfer", account_id=OTHER, to_account_id=3)

    result = _project([elsewhere, unlinked, other_transfer])

    assert result.events == []


# ── Debt accounts ────────────────────────────────────────────────────────────


def test_balance_delta_inverts_cash_flow_for_debt_accounts():
    assert balance_delta("current", -500) == -500
    assert balance_delta("savings", 500) == 500
    assert balance_delta("credit", -500) == 500
    assert balance_delta("loan", 500) == -500


def test_credit_card_projects_the_amount_owed():
    spend = _item(name="Streaming", amount_cents=1_500, start_date=date(2026, 11, 3))
    payment = _item(
        id=11,
        name="Card payment",
        kind="transfer",
        amount_cents=60_000,
        start_date=date(2026, 11, 20),
        account_id=OTHER,
        to_account_id=ACCOUNT,
        account_name="Household",
    )

    result = _project(
        [spend, payment],
        account_type="credit",
        start_balance_cents=50_000,
        months=1,
    )

    # Spending is money out but adds to what's owed; the payment pays it down.
    assert [e.amount_cents for e in result.events] == [-1_500, 60_000]
    assert [e.balance_after_cents for e in result.events] == [51_500, -8_500]
    assert result.events[1].counterparty_name == "Household"
    # Overpaying a card is a credit balance, not an overdraft.
    assert result.summary.first_negative_date is None
    assert result.summary.min_balance_cents == -8_500


# ── Interest ─────────────────────────────────────────────────────────────────


def _aer_interest(balance_cents: int, aer: float) -> int:
    return int(balance_cents * ((1 + aer / 100) ** (1 / 12) - 1) + 0.5)


def test_interest_is_credited_on_the_1st_at_the_aer_monthly_rate():
    result = _project(
        account_type="savings", interest_rate=5.0, start_balance_cents=1_000_000
    )

    interest = [e for e in result.events if e.kind == "interest"]
    assert [e.date for e in interest][:3] == [
        date(2026, 11, 1),
        date(2026, 12, 1),
        date(2027, 1, 1),
    ]
    assert len(interest) == 12
    first, second = interest[0], interest[1]
    assert first.amount_cents == _aer_interest(1_000_000, 5.0) == 4_074
    # Compounds on the running balance, not the start balance.
    assert second.amount_cents == _aer_interest(first.balance_after_cents, 5.0)
    assert (first.subscription_id, first.name, first.auto_post) == (
        None,
        "Interest",
        False,
    )
    assert first.frequency == "monthly"
    # Twelve monthly credits compound back up to the AER.
    assert result.horizons[-1].change_cents == 50_000


def test_interest_uses_the_balance_after_earlier_events():
    withdrawal = _item(amount_cents=500_000, start_date=date(2026, 10, 30))

    result = _project(
        [withdrawal],
        account_type="savings",
        interest_rate=5.0,
        start_balance_cents=1_000_000,
        months=1,
    )

    interest = next(e for e in result.events if e.kind == "interest")
    assert interest.amount_cents == _aer_interest(500_000, 5.0)


def test_interest_lands_before_same_day_items():
    bill = _item(amount_cents=10_000, start_date=date(2026, 11, 1))

    result = _project(
        [bill],
        account_type="savings",
        interest_rate=5.0,
        start_balance_cents=1_000_000,
        months=1,
    )

    assert [e.kind for e in result.events] == ["interest", "expense"]
    assert result.events[0].amount_cents == _aer_interest(1_000_000, 5.0)


def test_no_interest_events_at_a_zero_rate():
    result = _project(account_type="savings", interest_rate=0.0)
    assert result.events == []
    assert _project(account_type="savings", interest_rate=None).events == []


def test_debt_accounts_earn_no_interest():
    result = _project(account_type="loan", interest_rate=6.0)
    assert result.events == []


def test_no_interest_on_an_overdrawn_balance():
    result = _project(
        account_type="current", interest_rate=3.0, start_balance_cents=-10_000
    )
    assert result.events == []
    assert monthly_interest_cents(0, 3.0) == 0


def test_no_interest_credited_today_when_today_is_the_1st():
    result = _project(
        account_type="savings",
        interest_rate=5.0,
        today=date(2026, 11, 1),
        months=1,
    )

    assert [e.date for e in result.events] == [date(2026, 12, 1)]


# ── Horizons ─────────────────────────────────────────────────────────────────


def test_horizon_dates_clamp_to_month_ends():
    result = _project(today=date(2026, 1, 31))

    assert [(h.months, h.date) for h in result.horizons] == [
        (1, date(2026, 2, 28)),
        (3, date(2026, 4, 30)),
        (6, date(2026, 7, 31)),
        (12, date(2027, 1, 31)),
    ]
    assert result.points[-1].date == date(2027, 1, 31)


def test_horizon_clamps_to_a_leap_day():
    result = _project(today=date(2028, 1, 31), months=1)
    assert [h.date for h in result.horizons] == [date(2028, 2, 29)]


def test_horizons_report_closing_balance_and_change():
    bill = _item(amount_cents=1_000, start_date=date(2026, 11, 5))

    result = _project([bill])

    one, three, six, twelve = result.horizons
    assert (one.date, one.balance_cents, one.change_cents) == (
        date(2026, 11, 26),
        99_000,
        -1_000,
    )
    assert three.change_cents == -3_000
    assert six.change_cents == -6_000
    assert twelve.change_cents == -12_000


def test_only_horizons_inside_the_window_are_reported():
    assert [h.months for h in _project(months=3).horizons] == [1, 3]
    assert [h.months for h in _project(months=60).horizons] == [1, 3, 6, 12]
    assert len(_project(months=60).points) == 1827


def test_a_days_window_ends_that_many_days_ahead():
    result = _project(months=0, days=LOW_BALANCE_DAYS)

    assert LOW_BALANCE_DAYS == 30
    assert len(result.points) == 31  # today and the next 30 days
    assert result.points[-1].date == date(2026, 11, 25)
    # Only whole months that fit get a horizon: 1 month (26 Nov) doesn't.
    assert result.horizons == []
    assert [h.months for h in _project(months=0, days=31).horizons] == [1]


def test_a_days_window_matches_the_same_days_of_a_months_window():
    items = [_item(frequency="weekly", amount_cents=4_000)]
    short = _project(items, months=0, days=30, interest_rate=5.0)
    long = _project(items, months=12, interest_rate=5.0)

    assert short.points == long.points[:31]


def test_monthly_points_sample_the_closing_balance_each_month():
    # 31 Jan clamps to 28 Feb, as the horizons do.
    today = date(2027, 1, 31)
    rent = _item(start_date=date(2027, 2, 10), amount_cents=50_000)
    result = _project([rent], today=today, months=3)

    points = monthly_points(result, today, 3)

    assert [p.date for p in points] == [
        today,
        date(2027, 2, 28),
        date(2027, 3, 31),
        date(2027, 4, 30),
    ]
    assert [p.balance_cents for p in points] == [100_000, 50_000, 0, -50_000]
    assert points[3].balance_cents == result.horizons[1].balance_cents


def test_monthly_points_start_from_the_start_balance_not_todays_close():
    due_today = _item(amount_cents=2_500)
    result = _project([due_today], months=1)

    points = monthly_points(result, TODAY, 1)

    assert result.points[0].balance_cents == 97_500
    assert points[0] == Point(TODAY, 100_000)


def test_first_below_finds_the_first_day_under_the_threshold():
    points = [
        Point(TODAY, 30_000),
        Point(TODAY + timedelta(days=1), 20_000),
        Point(TODAY + timedelta(days=2), 15_000),
        Point(TODAY + timedelta(days=3), -5_000),
    ]

    assert first_below(points, 20_001) == points[1]
    assert first_below(points, 20_000) == points[2]  # touching it isn't below
    assert first_below(points, 0) == points[3]
    assert first_below(points, 31_000) == points[0]  # already under: today
    assert first_below(points, -5_000) is None


# ── Item lifecycle and handled dates ─────────────────────────────────────────


def test_end_date_mid_window_stops_the_item():
    gym = _item(start_date=date(2026, 11, 1), end_date=date(2027, 1, 15))

    result = _project([gym])

    assert [e.date for e in result.events] == [
        date(2026, 11, 1),
        date(2026, 12, 1),
        date(2027, 1, 1),
    ]
    assert result.summary.end_balance_cents == 97_000


def test_paused_items_are_excluded():
    result = _project([_item(active=False)])
    assert result.events == []


def test_handled_dates_are_excluded():
    weekly = _item(frequency="weekly", start_date=TODAY)
    handled = {
        (10, TODAY),
        (10, TODAY + timedelta(weeks=2)),
        (99, TODAY + timedelta(weeks=1)),
    }

    result = _project([weekly], months=1, handled=handled)

    dates = [e.date for e in result.events]
    assert TODAY not in dates
    assert TODAY + timedelta(weeks=2) not in dates
    # Another item's handled date doesn't hide this one's.
    assert TODAY + timedelta(weeks=1) in dates


def test_auto_post_is_carried_onto_events():
    result = _project([_item(auto_post=True)], months=1)
    assert result.events[0].auto_post is True


# ── Summary ──────────────────────────────────────────────────────────────────


def test_min_date_and_first_negative_date():
    big_bill = _item(
        id=1,
        name="Car repair",
        amount_cents=150_000,
        start_date=date(2026, 11, 2),
        frequency="annual",
    )
    payday = _item(
        id=2,
        name="Salary",
        kind="income",
        amount_cents=200_000,
        start_date=date(2026, 11, 10),
        frequency="annual",
    )
    small_bill = _item(
        id=3,
        name="Parking",
        amount_cents=10_000,
        start_date=date(2026, 10, 30),
        frequency="annual",
    )

    result = _project([big_bill, payday, small_bill], start_balance_cents=100_000)

    summary = result.summary
    assert summary.first_negative_date == date(2026, 11, 2)
    assert summary.min_balance_cents == -60_000
    assert summary.min_date == date(2026, 11, 2)
    # Back above zero by payday; none of the three recurs inside the year.
    assert _balance_on(result, date(2026, 11, 10)) == 140_000
    assert summary.end_balance_cents == 140_000


def test_min_date_is_the_first_day_the_low_is_reached():
    bill = _item(amount_cents=50_000, start_date=date(2026, 11, 5), frequency="annual")

    result = _project([bill])

    assert result.summary.min_balance_cents == 50_000
    assert result.summary.min_date == date(2026, 11, 5)
    assert result.summary.first_negative_date is None


@pytest.mark.parametrize("account_type", ["credit", "loan"])
def test_debt_accounts_never_report_a_first_negative_date(account_type):
    result = _project(account_type=account_type, start_balance_cents=-100)
    assert result.summary.first_negative_date is None
