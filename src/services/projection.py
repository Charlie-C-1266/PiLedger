"""Per-account balance projection — pure and DB-free: no connection, no I/O.

Rolls an account's current balance forward a day at a time through its
scheduled items and monthly interest, giving everything the account page's
projection half draws: a closing balance per day, the 1/3/6/12-month horizon
tiles, the dated events (each with the balance after it) behind the Upcoming
list, and the low point / first overdrawn day. The same run backs the savings
Projections window and the low-balance warning on account tiles.
``services/projection_inputs`` loads the rows and routers turn cents into
money; everything here is integer cents and ``date``.
Recurrence maths comes from ``services/subscriptions`` and the debt sign rule
from ``services/accounts.balance_delta``, so neither is restated here.

The rules (CONTEXT.md, "Projected balance"):

- Every active scheduled item touching the account counts, as its account or as
  a transfer's destination, reminders and auto-posting alike. Occurrences
  already handled (posted or skipped) don't, and nor do any after an item's
  ``end_date``.
- Occurrences due today count: the start balance is the latest snapshot, which
  doesn't include them yet.
- Asset accounts with a rate earn interest on each 1st after today. The rate is
  an AER, so the month's interest is balance × ((1 + AER/100)^(1/12) − 1) on
  that morning's balance. Debt accounts earn none here.
- One-off spending is never guessed.

Within a day, interest lands first, then money in, then money out, so the
balance after each event never dips below the day's closing balance on the way.
"""

from collections import defaultdict
from collections.abc import Iterable, Set
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from constants import DEBT_TYPES
from services.accounts import balance_delta
from services.subscriptions import add_months, occurrences_between

# The account page's horizon tiles, in months from today.
HORIZON_MONTHS = (1, 3, 6, 12)

# How far ahead the low-balance warning looks: today and the next 30 days, the
# same window as the account page's Upcoming card.
LOW_BALANCE_DAYS = 30

# How a projected interest credit reads in Upcoming. The category is the
# built-in income category, so the UI's category colours and icons apply.
INTEREST_NAME = "Interest"
INTEREST_CATEGORY = "Interest Earned"


@dataclass(frozen=True)
class ScheduledItem:
    """The parts of one scheduled item (a ``subscriptions`` row) a projection
    reads. ``amount_cents`` is always positive; ``kind`` gives the direction.
    The two names are those of the linked accounts, for "To …" / "From …"."""

    id: int
    name: str
    kind: str
    frequency: str
    category: str
    amount_cents: int
    start_date: date
    end_date: date | None
    account_id: int | None
    to_account_id: int | None
    account_name: str | None = None
    to_account_name: str | None = None
    active: bool = True
    auto_post: bool = False


@dataclass(frozen=True)
class Event:
    """One dated movement on the account: an occurrence of a scheduled item, or
    a projected interest credit (``kind == "interest"``, no subscription).

    ``amount_cents`` is the signed cash flow for this account (money out is
    negative); ``balance_after_cents`` is the stored balance once it lands,
    which for a debt account is the amount owed.
    """

    date: date
    subscription_id: int | None
    name: str
    kind: str
    frequency: str
    category: str
    counterparty_name: str | None
    amount_cents: int
    auto_post: bool
    balance_after_cents: int


@dataclass(frozen=True)
class Point:
    """The account's closing balance on one day."""

    date: date
    balance_cents: int


@dataclass(frozen=True)
class Horizon:
    """The closing balance a whole number of months ahead, and how far it has
    moved from the start balance."""

    months: int
    date: date
    balance_cents: int
    change_cents: int


@dataclass(frozen=True)
class Summary:
    """The series at a glance. ``min_date`` is the first day the lowest balance
    is reached; ``first_negative_date`` is the first day an asset account
    closes below zero (always None for a debt account, whose balance is owed)."""

    min_balance_cents: int
    min_date: date
    first_negative_date: date | None
    end_balance_cents: int


@dataclass(frozen=True)
class Projection:
    """Everything one projection request returns, in cents."""

    start_balance_cents: int
    points: list[Point]
    horizons: list[Horizon]
    events: list[Event]
    summary: Summary


def monthly_interest_cents(balance_cents: int, aer_percent: float) -> int:
    """One month's interest on ``balance_cents`` at an AER of ``aer_percent``.

    The monthly rate is the one that compounds back up to the AER over twelve
    months, (1 + AER/100)^(1/12) − 1; the result is rounded half-up to the cent.
    A zero or overdrawn balance, or a zero rate, earns nothing.
    """
    if balance_cents <= 0 or aer_percent <= 0:
        return 0
    rate = (1 + aer_percent / 100) ** (1 / 12) - 1
    return int(
        Decimal(balance_cents * rate).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )


def _cash_flow(item: ScheduledItem, account_id: int) -> tuple[int, str | None] | None:
    """The signed cash flow one occurrence of ``item`` puts through the account
    and the other account's name, or None when the item doesn't touch it.

    An expense is money out and income money in. A transfer is money out of its
    source and into its destination; its counterparty is the other end.
    """
    if item.kind == "transfer":
        if item.account_id == account_id:
            return -item.amount_cents, item.to_account_name
        if item.to_account_id == account_id:
            return item.amount_cents, item.account_name
        return None
    if item.account_id != account_id:
        return None
    sign = 1 if item.kind == "income" else -1
    return sign * item.amount_cents, None


def project(
    *,
    account_id: int,
    account_type: str,
    interest_rate: float | None,
    start_balance_cents: int,
    items: Iterable[ScheduledItem],
    today: date,
    months: int = 0,
    days: int = 0,
    handled: Set[tuple[int, date]] = frozenset(),
) -> Projection:
    """Project the account's balance from ``today`` to ``months`` calendar
    months (month-end clamped, so 31 Jan + 1 month is 28/29 Feb) and then
    ``days`` days ahead. Pass one of the two: the account page asks for months,
    the low-balance check for a fixed number of days.

    ``handled`` holds the ``(subscription_id, occurrence date)`` pairs already
    posted or skipped; those occurrences are left out. Horizons are reported for
    each of ``HORIZON_MONTHS`` that fits inside the window.
    """
    end = add_months(today.day, today.year, today.month, months) + timedelta(days=days)

    # Every pending occurrence in the window, grouped by day.
    due: dict[date, list[tuple[int, str | None, ScheduledItem]]] = defaultdict(list)
    for item in items:
        if not item.active:
            continue
        flow = _cash_flow(item, account_id)
        if flow is None:
            continue
        cash, counterparty = flow
        for day in occurrences_between(
            item.start_date, item.frequency, item.end_date, today, end
        ):
            if (item.id, day) not in handled:
                due[day].append((cash, counterparty, item))

    rate = interest_rate or 0.0
    earns_interest = account_type not in DEBT_TYPES and rate > 0

    balance = start_balance_cents
    points: list[Point] = []
    events: list[Event] = []
    day = today
    while day <= end:
        if earns_interest and day.day == 1 and day > today:
            interest = monthly_interest_cents(balance, rate)
            if interest:
                balance += balance_delta(account_type, interest)
                events.append(
                    Event(
                        date=day,
                        subscription_id=None,
                        name=INTEREST_NAME,
                        kind="interest",
                        frequency="monthly",
                        category=INTEREST_CATEGORY,
                        counterparty_name=None,
                        amount_cents=interest,
                        auto_post=False,
                        balance_after_cents=balance,
                    )
                )
        # Money in before money out, then by name for a stable order.
        for cash, counterparty, item in sorted(
            due.get(day, ()),
            key=lambda e: (e[0] < 0, e[2].name.lower(), e[2].id),
        ):
            balance += balance_delta(account_type, cash)
            events.append(
                Event(
                    date=day,
                    subscription_id=item.id,
                    name=item.name,
                    kind=item.kind,
                    frequency=item.frequency,
                    category=item.category,
                    counterparty_name=counterparty,
                    amount_cents=cash,
                    auto_post=item.auto_post,
                    balance_after_cents=balance,
                )
            )
        points.append(Point(day, balance))
        day += timedelta(days=1)

    horizons = []
    for n in HORIZON_MONTHS:
        horizon_date = add_months(today.day, today.year, today.month, n)
        if horizon_date > end:
            break
        closing = points[(horizon_date - today).days].balance_cents
        horizons.append(
            Horizon(n, horizon_date, closing, closing - start_balance_cents)
        )

    return Projection(
        start_balance_cents=start_balance_cents,
        points=points,
        horizons=horizons,
        events=events,
        summary=_summarise(points, account_type),
    )


def _summarise(points: list[Point], account_type: str) -> Summary:
    """The low point, first overdrawn day (asset accounts only) and closing
    balance of a non-empty series."""
    low = min(points, key=lambda p: p.balance_cents)  # first of any tie
    first_negative = None
    if account_type not in DEBT_TYPES:
        first_negative = next((p.date for p in points if p.balance_cents < 0), None)
    return Summary(
        min_balance_cents=low.balance_cents,
        min_date=low.date,
        first_negative_date=first_negative,
        end_balance_cents=points[-1].balance_cents,
    )


def monthly_points(result: Projection, today: date, months: int) -> list[Point]:
    """One point per calendar month for the savings Projections window: the
    start balance today, then the closing balance ``m`` months on (month-end
    clamped, like the horizons) for each ``m`` up to ``months``, which must fit
    inside ``result``. Month 12 is therefore the 12-month horizon."""
    out = [Point(today, result.start_balance_cents)]
    for m in range(1, months + 1):
        day = add_months(today.day, today.year, today.month, m)
        out.append(result.points[(day - today).days])
    return out


def first_below(points: Iterable[Point], threshold_cents: int) -> Point | None:
    """The first day the balance closes below ``threshold_cents``, or None.

    Drives the low-balance warning: an asset account is low when its projection
    over the next ``LOW_BALANCE_DAYS`` dips under the User's "Warn me below"
    amount (zero when they haven't set one). Today counts, so an account
    already under the amount is low from today.
    """
    return next((p for p in points if p.balance_cents < threshold_cents), None)
