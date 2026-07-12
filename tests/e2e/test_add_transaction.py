"""End-to-end coverage for the Add transaction modal.

Regression: the amount field used `inputMode="decimal"`, whose mobile keypad
has no "-" key, so an expense (negative amount) couldn't be entered on
mobile. The modal now has an Expense/Income toggle and the amount field only
ever takes a positive magnitude, with the sign applied from the toggle.
"""

from __future__ import annotations

from playwright.sync_api import expect


def _make_account(page) -> int:
    acc = page.request.post(
        "/api/accounts", data={"name": "Checking", "type": "current", "currency": "GBP"}
    )
    assert acc.ok, acc.text()
    return acc.json()["id"]


def test_add_expense_defaults_to_negative_without_minus_sign(signed_in_page):
    page = signed_in_page
    _make_account(page)
    page.goto("/transactions")

    page.get_by_role("button", name="+ Add").click()

    # Expense is selected by default; entering a plain positive number
    # should be saved as a negative (outgoing) amount.
    expect(page.get_by_role("button", name="Expense", exact=True)).to_be_visible()
    page.get_by_placeholder("Tesco, Spotify…").fill("Tesco")
    page.get_by_placeholder("Amount (e.g. 42.50)").fill("42.50")
    page.get_by_role("button", name="Save transaction").click()

    # Saving pops a confirmation toast in the corner as visual acknowledgement.
    expect(page.get_by_role("status")).to_contain_text("Transaction recorded!")
    expect(page.get_by_text("Tesco")).to_be_visible()
    expect(page.get_by_text("−£42.50").first).to_be_visible()


def test_add_income_via_toggle(signed_in_page):
    page = signed_in_page
    _make_account(page)
    page.goto("/transactions")

    page.get_by_role("button", name="+ Add").click()
    page.get_by_role("button", name="Income", exact=True).click()
    page.get_by_placeholder("Tesco, Spotify…").fill("Salary")
    page.get_by_placeholder("Amount (e.g. 42.50)").fill("3000")
    page.get_by_role("button", name="Save transaction").click()

    expect(page.get_by_text("Salary")).to_be_visible()
    expect(page.get_by_text("+£3,000.00")).to_be_visible()
