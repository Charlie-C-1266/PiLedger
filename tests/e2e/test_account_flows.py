"""
Top-level account flows: add, update balance, edit, delete.

These tests exercise the modal-driven interactions a real user goes through
and verify both the rendered dashboard and the summary cards stay consistent.
"""

from __future__ import annotations

from playwright.sync_api import Page, expect


def _open_add(page: Page) -> None:
    page.locator("#btn-add-account").click()
    page.locator("#add-account-modal").wait_for(state="visible")


def _submit_add(page: Page) -> None:
    page.locator("#add-account-modal button.btn-primary").click()
    page.locator("#add-account-modal").wait_for(state="hidden")


def test_add_savings_account_appears_and_updates_summary(signed_in_page: Page) -> None:
    page = signed_in_page

    # Pre-state: empty.
    expect(page.locator("#account-count")).to_have_text("0")
    expect(page.locator(".empty-state")).to_be_visible()

    _open_add(page)
    page.locator("#add-name").fill("HSBC Saver")
    page.locator("#add-type").select_option("savings")
    page.locator("#add-interest").fill("3.5")
    page.locator("#add-balance").fill("1250.50")
    _submit_add(page)

    # Account card present with the right values.
    card = page.locator(".account-card", has_text="HSBC Saver")
    expect(card).to_be_visible()
    expect(card.locator(".account-balance")).to_contain_text("1,250.50")
    expect(card.locator(".account-rate")).to_contain_text("3.5%")

    # Summary updates.
    expect(page.locator("#account-count")).to_have_text("1")
    expect(page.locator("#total-savings")).to_contain_text("1,250.50")
    expect(page.locator("#total-amount")).to_contain_text("1,250.50")


def test_update_balance_changes_card_and_total(signed_in_page: Page) -> None:
    page = signed_in_page

    _open_add(page)
    page.locator("#add-name").fill("Vanguard ISA")
    page.locator("#add-type").select_option("savings")
    page.locator("#add-balance").fill("500")
    _submit_add(page)

    card = page.locator(".account-card", has_text="Vanguard ISA")
    expect(card.locator(".account-balance")).to_contain_text("500.00")

    card.get_by_role("button", name="Update Balance").click()
    page.locator("#update-balance-modal").wait_for(state="visible")
    amount = page.locator("#update-balance-amount")
    amount.fill("")
    amount.fill("2750.00")
    page.locator("#update-balance-notes").fill("Quarterly check")
    page.locator("#update-balance-modal button.btn-primary").click()
    page.locator("#update-balance-modal").wait_for(state="hidden")

    expect(card.locator(".account-balance")).to_contain_text("2,750.00")
    expect(page.locator("#total-amount")).to_contain_text("2,750.00")


def test_loan_account_classified_as_debt_in_summary(signed_in_page: Page) -> None:
    page = signed_in_page

    _open_add(page)
    page.locator("#add-name").fill("Credit Card")
    page.locator("#add-type").select_option("loan")
    page.locator("#add-interest").fill("19.9")
    page.locator("#add-balance").fill("1500")
    _submit_add(page)

    card = page.locator(".account-card", has_text="Credit Card")
    expect(card).to_be_visible()
    # APR label rather than AER.
    expect(card.locator(".account-rate")).to_contain_text("APR")
    # Debt total picked up.
    expect(page.locator("#total-loans")).to_contain_text("1,500.00")
    # Savings/current cards untouched.
    expect(page.locator("#total-savings")).to_contain_text("0.00")
    expect(page.locator("#total-current")).to_contain_text("0.00")


def test_subtype_dropdown_repopulates_when_type_changes(signed_in_page: Page) -> None:
    """Switching type must reset the subtype options to the valid set for
    the new type — otherwise you can submit a nonsense combo like
    current+mortgage."""
    page = signed_in_page

    _open_add(page)
    # Default type is `current` → subtype list includes 'joint' but NOT 'mortgage'.
    current_opts = page.locator("#add-subtype option").evaluate_all(
        "els => els.map(e => e.value)"
    )
    assert "joint" in current_opts
    assert "mortgage" not in current_opts

    page.locator("#add-type").select_option("loan")
    loan_opts = page.locator("#add-subtype option").evaluate_all(
        "els => els.map(e => e.value)"
    )
    assert "mortgage" in loan_opts
    assert "joint" not in loan_opts


def test_edit_account_renames_card(signed_in_page: Page) -> None:
    page = signed_in_page

    _open_add(page)
    page.locator("#add-name").fill("Old Name")
    page.locator("#add-type").select_option("current")
    _submit_add(page)

    card = page.locator(".account-card", has_text="Old Name")
    card.locator("button.btn-icon").click()  # the pencil
    page.locator("#edit-account-modal").wait_for(state="visible")
    name = page.locator("#edit-name")
    name.fill("")
    name.fill("New Name")
    page.locator("#edit-account-modal button.btn-primary").click()
    page.locator("#edit-account-modal").wait_for(state="hidden")

    expect(page.locator(".account-card", has_text="New Name")).to_be_visible()
    expect(page.locator(".account-card", has_text="Old Name")).to_have_count(0)


def test_delete_account_removes_card_and_returns_to_empty_state(
    signed_in_page: Page,
) -> None:
    page = signed_in_page

    _open_add(page)
    page.locator("#add-name").fill("Throwaway")
    page.locator("#add-type").select_option("current")
    _submit_add(page)

    page.locator(".account-card", has_text="Throwaway").locator(
        "button.btn-icon"
    ).click()
    page.locator("#edit-account-modal").wait_for(state="visible")
    page.locator("#edit-account-modal").get_by_role(
        "button", name="Delete Account"
    ).click()

    page.locator("#confirm-delete-modal").wait_for(state="visible")
    expect(page.locator("#delete-account-name")).to_have_text("Throwaway")
    page.locator("#confirm-delete-modal").get_by_role("button", name="Delete").click()
    page.locator("#confirm-delete-modal").wait_for(state="hidden")

    expect(page.locator(".account-card", has_text="Throwaway")).to_have_count(0)
    expect(page.locator(".empty-state")).to_be_visible()
    expect(page.locator("#account-count")).to_have_text("0")


def test_view_switcher_toggles_budget_planner(signed_in_page: Page) -> None:
    page = signed_in_page

    expect(page.locator("#view-overview")).to_be_visible()
    expect(page.locator("#view-budget")).to_be_hidden()

    page.get_by_role("button", name="Budget Planner").click()
    expect(page.locator("#view-budget")).to_be_visible()
    expect(page.locator("#view-overview")).to_be_hidden()

    page.get_by_role("button", name="Overview").click()
    expect(page.locator("#view-overview")).to_be_visible()
    expect(page.locator("#view-budget")).to_be_hidden()
