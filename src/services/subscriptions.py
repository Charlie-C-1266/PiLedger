"""Recurrence date math for subscriptions — pure, DB-free, stdlib only.

Kept out of the router so the genuinely fiddly part (month-end clamping,
leap-year handling) has its own focused unit suite and no FastAPI/SQLite
plumbing. The router computes each row's ``next_due_date`` through
``next_occurrence`` and expands the calendar window through
``occurrences_between``; the frontend never does recurrence math.
"""

from calendar import monthrange
from datetime import date, timedelta

# Fixed-stride frequencies recur a constant number of days apart; calendar
# frequencies recur on the same day-of-month a number of months apart (with
# clamping for short months). Mirrors constants.FREQUENCIES — kept as plain
# literals here so the module stays import-light and DB-free.
_STRIDE_DAYS = {"weekly": 7, "biweekly": 14}
_STEP_MONTHS = {"monthly": 1, "quarterly": 3, "annual": 12}


def _add_months(anchor_day: int, year: int, month: int, months: int) -> date:
    """The date ``months`` after ``(year, month)`` on ``anchor_day``, clamped to
    the target month's length (so a 31st anchor lands on Feb-28/29)."""
    total = year * 12 + (month - 1) + months
    y, m = divmod(total, 12)
    m += 1
    day = min(anchor_day, monthrange(y, m)[1])
    return date(y, m, day)


def next_occurrence(start: date, frequency: str, on_or_after: date) -> date:
    """First due date on or after ``on_or_after``.

    Weekly/biweekly recur on a fixed day stride. Monthly/quarterly/annual recur
    on the same calendar day each period, clamped to the last valid day of a
    short month — a 31st monthly anchor lands on Feb-28/29, and a Feb-29 annual
    anchor lands on Feb-28 in a non-leap year. If ``on_or_after`` precedes
    ``start``, the first occurrence is ``start`` itself.
    """
    if on_or_after <= start:
        return start
    if frequency in _STRIDE_DAYS:
        stride = _STRIDE_DAYS[frequency]
        delta = (on_or_after - start).days
        n = -(-delta // stride)  # ceil division
        return start + timedelta(days=n * stride)
    if frequency in _STEP_MONTHS:
        step = _STEP_MONTHS[frequency]
        # months_apart // step is a safe lower bound for the period index (an
        # earlier index is always a full step — at least a month — before the
        # target, so it can't be the answer); nudge forward to the first hit.
        months_apart = (on_or_after.year - start.year) * 12 + (
            on_or_after.month - start.month
        )
        k = max(0, months_apart // step)
        occ = _add_months(start.day, start.year, start.month, k * step)
        while occ < on_or_after:
            k += 1
            occ = _add_months(start.day, start.year, start.month, k * step)
        return occ
    raise ValueError(f"unknown frequency: {frequency}")


def occurrences_between(
    start: date,
    frequency: str,
    end: date | None,
    window_start: date,
    window_end: date,
) -> list[date]:
    """Every due date within ``[window_start, window_end]`` (both inclusive).

    Occurrences before ``start`` or after a non-null ``end`` are excluded. Steps
    through the series via ``next_occurrence`` so the stride/clamp rules live in
    exactly one place.
    """
    if window_end < window_start:
        return []
    results: list[date] = []
    occ = next_occurrence(start, frequency, max(window_start, start))
    while occ <= window_end:
        if end is not None and occ > end:
            break
        results.append(occ)
        occ = next_occurrence(start, frequency, occ + timedelta(days=1))
    return results
