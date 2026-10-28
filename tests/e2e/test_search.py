"""
End-to-end coverage for the global header search palette.

Seeds an account, a goal and a transaction via the API (reusing the browser's
session cookie), then drives the search overlay from the desktop header:
account/goal matches come from the cached lists, transaction matches come from
the server-side `?search=` query, selecting a transaction deep-links to
`/transactions?q=<term>` with the list pre-filtered, and selecting an account
opens that account's own page — its projection, Upcoming card and a manual
balance update (recorded as a Balance adjustment) included.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from playwright.sync_api import expect


def _seed(page) -> int:
    """Create one account, one goal and one transaction for the signed-in user,
    returning the account's id."""
    acc = page.request.post(
        "/api/accounts",
        data={"name": "Holiday Savings", "type": "savings", "currency": "GBP"},
    )
    assert acc.ok, acc.text()
    account_id = acc.json()["id"]

    goal = page.request.post(
        "/api/goals", data={"name": "Holiday Trip", "target": 1000}
    )
    assert goal.ok, goal.text()

    txn = page.request.post(
        "/api/transactions",
        data={"account_id": account_id, "amount": -42.5, "merchant": "Tesco Express"},
    )
    assert txn.ok, txn.text()

    # The page loaded (and cached empty account/goal lists) at login, before
    # this API seeding. Reload so React Query refetches the seeded data — in the
    # real app the Add flows invalidate these caches, but direct API seeding
    # bypasses that.
    page.reload()
    page.get_by_text("ACCESSIBLE NET WORTH", exact=True).wait_for(state="visible")
    return account_id


def test_search_matches_accounts_and_goals(signed_in_page) -> None:
    page = signed_in_page
    account_id = _seed(page)
    # A reminder due in five days, so the account page has something upcoming.
    # Created after _seed's reload; the account page fetches its projection
    # fresh when it opens.
    due = date.today() + timedelta(days=5)
    item = page.request.post(
        "/api/subscriptions",
        data={
            "name": "Gym membership",
            "amount": 35,
            "frequency": "monthly",
            "start_date": due.isoformat(),
            "account_id": account_id,
        },
    )
    assert item.ok, item.text()

    page.get_by_role("button", name="Search").click()
    dialog = page.get_by_role("dialog", name="Search")
    box = dialog.get_by_role("textbox", name="Search query")
    expect(box).to_be_visible()
    box.fill("holiday")

    # Both the account and the goal match "holiday" by name — assert within the
    # palette so an unrelated overview card can't satisfy the locator.
    expect(dialog.get_by_text("Holiday Savings")).to_be_visible()
    expect(dialog.get_by_text("Holiday Trip")).to_be_visible()

    # Selecting the account opens its own page (read-only: no new data, so
    # this extends the test rather than adding a mutating one).
    dialog.get_by_role("button", name=re.compile("Holiday Savings")).click()
    page.wait_for_url(f"**/accounts/{account_id}")
    expect(page.get_by_role("heading", level=1, name="Holiday Savings")).to_be_visible()
    expect(page.get_by_text("Counts toward net worth")).to_be_visible()
    recent = page.get_by_role("region", name="Recent transactions")
    expect(recent.get_by_text("Tesco Express")).to_be_visible()
    expect(recent.get_by_text("Last 30 days · 1 transaction")).to_be_visible()

    # The projection: four horizon tiles (3 months picked) over the chart.
    horizons = page.get_by_role("radiogroup", name="Projected balance")
    expect(horizons.get_by_role("radio")).to_have_count(4)
    expect(
        horizons.get_by_role("radio", name=re.compile("In 3 months"))
    ).to_be_checked()
    expect(page.get_by_role("group", name=re.compile("Balance chart"))).to_be_visible()

    # Upcoming lists the reminder; Skip takes it out, and the toast's Undo
    # brings it back. Each step waits for the list to redraw before the next.
    upcoming = page.get_by_role("region", name="Upcoming")
    row = upcoming.get_by_role("button", name=re.compile("^Gym membership"))
    expect(row).to_be_visible()
    row.click()
    dialog = page.get_by_role("dialog", name="Gym membership")
    expect(
        dialog.get_by_text("Reminder only: it won't post by itself.")
    ).to_be_visible()
    dialog.get_by_role("button", name=re.compile("Skip this one")).click()
    toast = page.get_by_role("status").filter(has_text="Gym membership skipped for")
    expect(toast).to_contain_text(f"Gym membership skipped for {due.day} {due:%b}")
    expect(row).to_have_count(0)
    toast.get_by_role("button", name="Undo").click()
    expect(row).to_be_visible()

    # Update balance records the change as a Balance adjustment, which shows in
    # Recent transactions straight away (−£42.50 → £100.00 is +£142.50).
    page.get_by_role("button", name="Update balance").click()
    update = page.get_by_role("dialog", name="Update balance")
    update.get_by_role("textbox", name="New balance").fill("100")
    update.get_by_role("button", name="Update balance").click()
    expect(
        page.get_by_role("status").filter(has_text="Balance updated")
    ).to_be_visible()
    expect(recent.get_by_text("Balance adjustment", exact=True)).to_be_visible()
    expect(recent.get_by_role("img", name="Balance set by hand")).to_be_visible()
    expect(recent.get_by_text("+£142.50")).to_be_visible()
    expect(recent.get_by_text("Last 30 days · 2 transactions")).to_be_visible()

    # "View all" lands on Transactions filtered to this account.
    recent.get_by_role("link", name=re.compile("View all")).click()
    page.wait_for_url(f"**/transactions?account={account_id}")
    expect(page.get_by_text("Tesco Express")).to_be_visible()
    expect(page.get_by_text("Balance adjustment", exact=True)).to_be_visible()


def test_search_transaction_deep_links_to_filtered_list(signed_in_page) -> None:
    page = signed_in_page
    _seed(page)

    page.get_by_role("button", name="Search").click()
    dialog = page.get_by_role("dialog", name="Search")
    dialog.get_by_role("textbox", name="Search query").fill("tesco")

    # The transaction match comes back from the server-side search (debounced).
    result = dialog.get_by_role("button", name="Tesco Express")
    expect(result).to_be_visible()
    result.click()

    # Selecting it lands on the Transactions screen, pre-filtered to the term.
    page.wait_for_url("**/transactions?q=tesco")
    expect(page.get_by_placeholder("Search…")).to_have_value("tesco")
    expect(page.get_by_text("Tesco Express")).to_be_visible()
