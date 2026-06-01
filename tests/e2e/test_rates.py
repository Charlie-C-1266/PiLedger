"""
End-to-end coverage for the manual FX-rates flow.

Creates a foreign-currency account, confirms the Overview "net worth may be
inaccurate" banner surfaces the missing rate, then sets the rate in Settings
and confirms it saves and the banner clears.
"""

from __future__ import annotations

import re

from playwright.sync_api import expect


def _make_usd_account(page) -> None:
    acc = page.request.post(
        "/api/accounts",
        data={"name": "Dollars", "type": "current", "currency": "USD"},
    )
    assert acc.ok, acc.text()


def test_missing_rate_banner_then_set_rate(signed_in_page):
    page = signed_in_page
    _make_usd_account(page)

    # A USD account against a GBP base with no rate → the Overview banner.
    page.goto("/overview")
    banner = page.get_by_role("link", name=re.compile("Net worth may be inaccurate"))
    expect(banner).to_be_visible()

    # The banner links to Settings, where the missing currency is pre-seeded as
    # an empty rate row ready to fill.
    banner.click()
    expect(page).to_have_url(re.compile(r"/settings$"))
    rate_input = page.get_by_label("Value of 1 USD in GBP")
    expect(rate_input).to_be_visible()
    rate_input.fill("0.79")
    page.get_by_role("button", name="Save rates").click()
    expect(page.get_by_text("Exchange rates saved")).to_be_visible()

    # With a rate set, the Overview warning clears.
    page.goto("/overview")
    expect(page.get_by_text("Net worth may be inaccurate")).to_have_count(0)


def test_add_currency_row_and_save(signed_in_page):
    """The editor can add a rate for a currency no account uses yet (e.g. to
    pre-load it), via the 'Add a currency' picker."""
    page = signed_in_page
    page.goto("/settings")

    page.get_by_label("Add a currency").select_option("EUR")
    page.get_by_role("button", name="Add exchange rate").click()
    eur_input = page.get_by_label("Value of 1 EUR in GBP")
    expect(eur_input).to_be_visible()
    eur_input.fill("0.85")
    page.get_by_role("button", name="Save rates").click()
    expect(page.get_by_text("Exchange rates saved")).to_be_visible()
