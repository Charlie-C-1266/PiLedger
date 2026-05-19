"""
Summary tiles double as type filters for the Accounts grid.

Behaviour under test:
* Click Savings / Current / Loan → only matching account cards visible.
* Active tile gains `aria-pressed="true"`; others go back to `false`.
* Clicking the active tile again clears the filter.
* The 'Accounts' (count) tile always shows every account.
* Charts and summary numbers stay global — only the cards below change.
"""
from __future__ import annotations

from playwright.sync_api import Page, expect


def _add(page: Page, name: str, type_value: str, opening_balance: str | None = None) -> None:
    page.locator("#btn-add-account").click()
    page.locator("#add-account-modal").wait_for(state="visible")
    page.locator("#add-name").fill(name)
    page.locator("#add-type").select_option(type_value)
    if opening_balance is not None:
        page.locator("#add-balance").fill(opening_balance)
    page.locator("#add-account-modal button.btn-primary").click()
    page.locator("#add-account-modal").wait_for(state="hidden")
    page.locator(".account-card", has_text=name).wait_for(state="visible")


def _seed_one_of_each(page: Page) -> None:
    _add(page, "Saver A", "savings", "1000")
    _add(page, "Current B", "current", "500")
    _add(page, "Loan C", "loan", "750")


def test_default_state_shows_all_accounts_with_all_tile_active(signed_in_page: Page) -> None:
    page = signed_in_page
    _seed_one_of_each(page)

    expect(page.locator(".account-card")).to_have_count(3)
    # The count tile starts active.
    expect(page.locator(".summary-card[data-filter='all']")).to_have_attribute(
        "aria-pressed", "true"
    )
    for f in ("savings", "current", "loan"):
        expect(page.locator(f".summary-card[data-filter='{f}']")).to_have_attribute(
            "aria-pressed", "false"
        )


def test_clicking_savings_tile_narrows_grid(signed_in_page: Page) -> None:
    page = signed_in_page
    _seed_one_of_each(page)

    page.locator(".summary-card[data-filter='savings']").click()

    expect(page.locator(".summary-card[data-filter='savings']")).to_have_attribute(
        "aria-pressed", "true"
    )
    expect(page.locator(".summary-card[data-filter='all']")).to_have_attribute(
        "aria-pressed", "false"
    )
    cards = page.locator(".account-card")
    expect(cards).to_have_count(1)
    expect(cards.first).to_contain_text("Saver A")
    # Summary numbers must not move — they are dashboard-wide totals.
    expect(page.locator("#account-count")).to_have_text("3")


def test_clicking_current_tile_swaps_filter(signed_in_page: Page) -> None:
    page = signed_in_page
    _seed_one_of_each(page)

    page.locator(".summary-card[data-filter='savings']").click()
    page.locator(".summary-card[data-filter='current']").click()

    expect(page.locator(".summary-card[data-filter='current']")).to_have_attribute(
        "aria-pressed", "true"
    )
    expect(page.locator(".summary-card[data-filter='savings']")).to_have_attribute(
        "aria-pressed", "false"
    )
    cards = page.locator(".account-card")
    expect(cards).to_have_count(1)
    expect(cards.first).to_contain_text("Current B")


def test_clicking_active_filter_again_clears_it(signed_in_page: Page) -> None:
    page = signed_in_page
    _seed_one_of_each(page)

    tile = page.locator(".summary-card[data-filter='loan']")
    tile.click()
    expect(page.locator(".account-card")).to_have_count(1)

    tile.click()
    expect(page.locator(".account-card")).to_have_count(3)
    expect(tile).to_have_attribute("aria-pressed", "false")
    expect(page.locator(".summary-card[data-filter='all']")).to_have_attribute(
        "aria-pressed", "true"
    )


def test_count_tile_always_clears_filter(signed_in_page: Page) -> None:
    page = signed_in_page
    _seed_one_of_each(page)

    page.locator(".summary-card[data-filter='savings']").click()
    expect(page.locator(".account-card")).to_have_count(1)

    page.locator(".summary-card[data-filter='all']").click()
    expect(page.locator(".account-card")).to_have_count(3)
    expect(page.locator(".summary-card[data-filter='all']")).to_have_attribute(
        "aria-pressed", "true"
    )


def test_filter_with_no_matching_accounts_shows_empty_state(signed_in_page: Page) -> None:
    """A user with only savings, who clicks Loans, sees a friendly empty
    state and a 'Show all' escape hatch — not a blank panel."""
    page = signed_in_page
    _add(page, "Solo Saver", "savings", "100")

    page.locator(".summary-card[data-filter='loan']").click()
    empty = page.locator(".empty-state")
    expect(empty).to_be_visible()
    expect(empty).to_contain_text("No loan accounts")

    empty.get_by_role("button", name="Show all").click()
    expect(page.locator(".account-card")).to_have_count(1)
    expect(page.locator(".summary-card[data-filter='all']")).to_have_attribute(
        "aria-pressed", "true"
    )


def test_filter_persists_across_balance_update(signed_in_page: Page) -> None:
    """An update-balance round trip calls loadAll() which re-renders the grid.
    The active filter must survive that re-render, otherwise users get
    snapped back to the full list every time they touch a balance."""
    page = signed_in_page
    _seed_one_of_each(page)

    page.locator(".summary-card[data-filter='current']").click()
    expect(page.locator(".account-card")).to_have_count(1)

    card = page.locator(".account-card", has_text="Current B")
    card.get_by_role("button", name="Update Balance").click()
    page.locator("#update-balance-modal").wait_for(state="visible")
    amt = page.locator("#update-balance-amount")
    amt.fill("")
    amt.fill("999")
    page.locator("#update-balance-modal button.btn-primary").click()
    page.locator("#update-balance-modal").wait_for(state="hidden")

    # Filter still active, grid still narrowed.
    expect(page.locator(".summary-card[data-filter='current']")).to_have_attribute(
        "aria-pressed", "true"
    )
    expect(page.locator(".account-card")).to_have_count(1)
    expect(page.locator(".account-card").first.locator(".account-balance")).to_contain_text(
        "999.00"
    )
