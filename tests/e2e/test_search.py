"""
End-to-end coverage for the global header search palette.

Seeds an account, a goal and a transaction via the API (reusing the browser's
session cookie), then drives the search overlay from the desktop header:
account/goal matches come from the cached lists, transaction matches come from
the server-side `?search=` query, and selecting a transaction deep-links to
`/transactions?q=<term>` with the list pre-filtered.
"""

from __future__ import annotations

from playwright.sync_api import expect


def _seed(page) -> None:
    """Create one account, one goal and one transaction for the signed-in user."""
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


def test_search_matches_accounts_and_goals(signed_in_page) -> None:
    page = signed_in_page
    _seed(page)

    page.get_by_role("button", name="Search").click()
    dialog = page.get_by_role("dialog", name="Search")
    box = dialog.get_by_role("textbox", name="Search query")
    expect(box).to_be_visible()
    box.fill("holiday")

    # Both the account and the goal match "holiday" by name — assert within the
    # palette so an unrelated overview card can't satisfy the locator.
    expect(dialog.get_by_text("Holiday Savings")).to_be_visible()
    expect(dialog.get_by_text("Holiday Trip")).to_be_visible()


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
