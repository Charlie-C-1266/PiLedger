"""Pure recurrence date-math tests for services/subscriptions.

The highest-value subscription suite: no DB, no HTTP — just the month-end
clamping and stride logic that the calendar and the list's next-due both lean on.
"""

from datetime import date

from services.subscriptions import next_occurrence, occurrences_between


# ── next_occurrence: before-start / on-start ─────────────────────────────────


def test_on_or_after_before_start_returns_start():
    start = date(2026, 3, 10)
    assert next_occurrence(start, "monthly", date(2026, 1, 1)) == start


def test_on_or_after_equal_start_returns_start():
    start = date(2026, 3, 10)
    assert next_occurrence(start, "weekly", start) == start


# ── Fixed strides ────────────────────────────────────────────────────────────


def test_weekly_stride():
    start = date(2026, 1, 1)  # Thursday
    assert next_occurrence(start, "weekly", date(2026, 1, 2)) == date(2026, 1, 8)
    assert next_occurrence(start, "weekly", date(2026, 1, 8)) == date(2026, 1, 8)
    assert next_occurrence(start, "weekly", date(2026, 1, 9)) == date(2026, 1, 15)


def test_biweekly_stride():
    start = date(2026, 1, 1)
    assert next_occurrence(start, "biweekly", date(2026, 1, 2)) == date(2026, 1, 15)
    assert next_occurrence(start, "biweekly", date(2026, 1, 16)) == date(2026, 1, 29)


# ── Monthly month-end clamping ───────────────────────────────────────────────


def test_monthly_anchored_on_31st_clamps_to_short_months():
    start = date(2026, 1, 31)
    # February 2026 is not a leap year → clamp to the 28th.
    assert next_occurrence(start, "monthly", date(2026, 2, 1)) == date(2026, 2, 28)
    # April has 30 days.
    assert next_occurrence(start, "monthly", date(2026, 4, 1)) == date(2026, 4, 30)
    # The anchor day returns in a long month.
    assert next_occurrence(start, "monthly", date(2026, 5, 1)) == date(2026, 5, 31)


def test_monthly_anchored_on_31st_leap_february():
    start = date(2024, 1, 31)
    # February 2024 is a leap year → clamp to the 29th.
    assert next_occurrence(start, "monthly", date(2024, 2, 1)) == date(2024, 2, 29)


def test_monthly_same_month_later_day():
    start = date(2026, 1, 15)
    assert next_occurrence(start, "monthly", date(2026, 1, 20)) == date(2026, 2, 15)


# ── Quarterly ────────────────────────────────────────────────────────────────


def test_quarterly_steps_three_months():
    start = date(2026, 1, 15)
    assert next_occurrence(start, "quarterly", date(2026, 2, 1)) == date(2026, 4, 15)
    assert next_occurrence(start, "quarterly", date(2026, 5, 1)) == date(2026, 7, 15)


def test_quarterly_crosses_year_boundary():
    start = date(2026, 11, 20)
    assert next_occurrence(start, "quarterly", date(2027, 1, 1)) == date(2027, 2, 20)


# ── Annual / leap-year ───────────────────────────────────────────────────────


def test_annual_feb_29_clamps_in_non_leap_year():
    start = date(2024, 2, 29)
    # 2025 is not a leap year → clamp to Feb-28.
    assert next_occurrence(start, "annual", date(2025, 1, 1)) == date(2025, 2, 28)
    # 2028 is a leap year → the 29th returns.
    assert next_occurrence(start, "annual", date(2028, 1, 1)) == date(2028, 2, 29)


# ── occurrences_between ──────────────────────────────────────────────────────


def test_occurrences_weekly_within_window():
    start = date(2026, 1, 1)
    got = occurrences_between(
        start, "weekly", None, date(2026, 1, 1), date(2026, 1, 31)
    )
    assert got == [
        date(2026, 1, 1),
        date(2026, 1, 8),
        date(2026, 1, 15),
        date(2026, 1, 22),
        date(2026, 1, 29),
    ]


def test_occurrences_excludes_dates_before_start():
    start = date(2026, 1, 20)
    got = occurrences_between(
        start, "monthly", None, date(2026, 1, 1), date(2026, 3, 31)
    )
    assert got == [date(2026, 1, 20), date(2026, 2, 20), date(2026, 3, 20)]


def test_occurrences_respects_end_date_inside_window():
    start = date(2026, 1, 1)
    got = occurrences_between(
        start, "weekly", date(2026, 1, 16), date(2026, 1, 1), date(2026, 1, 31)
    )
    assert got == [date(2026, 1, 1), date(2026, 1, 8), date(2026, 1, 15)]


def test_occurrences_empty_when_window_inverted():
    start = date(2026, 1, 1)
    assert (
        occurrences_between(start, "weekly", None, date(2026, 2, 1), date(2026, 1, 1))
        == []
    )


def test_occurrences_monthly_clamps_within_window():
    start = date(2026, 1, 31)
    got = occurrences_between(
        start, "monthly", None, date(2026, 2, 1), date(2026, 4, 30)
    )
    assert got == [date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
