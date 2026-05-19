"""
Confirm the UI rejects unreasonable balance / amount inputs.

The frontend has two failure surfaces:

* `alert()` — fired by `submitAddAccount`, `submitUpdateBalance` etc. on local
  validation errors and on API errors. We capture these via the page's
  `dialog` event.
* The number `<input type="number">` itself, whose `min`/`step` constraints
  prevent invalid values from being submitted in the first place. We assert
  validity via the DOM ValidityState API.

The backend caps money at ±£1 trillion (`constants.MAX_MONEY`); anything
beyond that should be rejected with a 400 that surfaces as an alert.
"""
from __future__ import annotations

import pytest
from playwright.sync_api import Dialog, Page, expect

MAX_MONEY = 1_000_000_000_000.0


def _add_account(page: Page, name: str, type_value: str = "savings") -> None:
    page.locator("#btn-add-account").click()
    page.locator("#add-account-modal").wait_for(state="visible")
    page.locator("#add-name").fill(name)
    page.locator("#add-type").select_option(type_value)
    page.locator("#add-account-modal button.btn-primary").click()
    page.locator("#add-account-modal").wait_for(state="hidden")


def _wait_for_account(page: Page, name: str) -> None:
    page.locator(".account-card", has_text=name).wait_for(state="visible")


def test_blank_account_name_is_rejected(signed_in_page: Page) -> None:
    page = signed_in_page
    dialogs: list[str] = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

    page.locator("#btn-add-account").click()
    page.locator("#add-account-modal").wait_for(state="visible")
    # Name left blank intentionally.
    page.locator("#add-account-modal button.btn-primary").click()

    # `submitAddAccount` calls `alert('Please enter an account name.')`.
    page.wait_for_timeout(100)
    assert any("account name" in m.lower() for m in dialogs), dialogs
    # Modal stays open — the submit was blocked, not silently succeeded.
    expect(page.locator("#add-account-modal")).to_be_visible()


def test_negative_balance_blocked_by_input_constraint(signed_in_page: Page) -> None:
    """The Update Balance input has min=0 — typing a negative value leaves it
    in an `:invalid` state, and the submit `parseFloat` then sees NaN/blank
    and fires the alert path."""
    page = signed_in_page
    _add_account(page, "Nationwide Saver", "savings")
    _wait_for_account(page, "Nationwide Saver")

    dialogs: list[str] = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

    page.locator(".account-card", has_text="Nationwide Saver").get_by_role(
        "button", name="Update Balance"
    ).click()
    page.locator("#update-balance-modal").wait_for(state="visible")

    amount = page.locator("#update-balance-amount")
    amount.fill("-500")

    # The browser flags the value as invalid because of min=0.
    is_valid = amount.evaluate("el => el.checkValidity()")
    assert is_valid is False, "expected min=0 to mark a negative value invalid"


def test_balance_exceeding_max_money_is_rejected_by_server(signed_in_page: Page) -> None:
    """A 2-trillion deposit should clear the client (it's a number) but the
    server's `BalanceIn` schema caps at MAX_MONEY, returning 400 → alert."""
    page = signed_in_page
    _add_account(page, "Crypto Pile", "savings")
    _wait_for_account(page, "Crypto Pile")

    dialogs: list[Dialog] = []
    def _on_dialog(d: Dialog) -> None:
        dialogs.append(d)
        d.accept()
    page.on("dialog", _on_dialog)

    page.locator(".account-card", has_text="Crypto Pile").get_by_role(
        "button", name="Update Balance"
    ).click()
    page.locator("#update-balance-modal").wait_for(state="visible")

    over_cap = MAX_MONEY * 2
    page.locator("#update-balance-amount").fill(str(over_cap))
    page.locator("#update-balance-modal button.btn-primary").click()

    # Wait until the API call has come back and triggered the alert.
    page.wait_for_function("window.__lastErrAlert !== undefined || true")
    page.wait_for_timeout(500)

    assert dialogs, "expected an Error alert from the API call"
    msg = dialogs[-1].message
    assert msg.startswith("Error:"), f"unexpected alert: {msg!r}"
    # The detail string from FastAPI mentions the field bound that tripped.
    assert "less than or equal" in msg.lower() or "1000000000000" in msg, msg

    # Balance card should not have updated — value remains '—' (no balance yet).
    expect(
        page.locator(".account-card", has_text="Crypto Pile")
            .locator(".account-balance")
    ).not_to_contain_text("2,000,000,000,000")


def test_non_numeric_balance_blocked(signed_in_page: Page) -> None:
    """`type="number"` won't even accept letters; the value stays blank, so
    `parseFloat` is NaN and the alert path runs."""
    page = signed_in_page
    _add_account(page, "Loose Change", "savings")
    _wait_for_account(page, "Loose Change")

    dialogs: list[str] = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

    page.locator(".account-card", has_text="Loose Change").get_by_role(
        "button", name="Update Balance"
    ).click()
    page.locator("#update-balance-modal").wait_for(state="visible")

    amount = page.locator("#update-balance-amount")
    # Clear out the prefilled current_balance, then try to type letters.
    amount.fill("")
    amount.press_sequentially("abc")
    page.locator("#update-balance-modal button.btn-primary").click()

    page.wait_for_timeout(100)
    assert any("valid balance" in m.lower() for m in dialogs), dialogs
    expect(page.locator("#update-balance-modal")).to_be_visible()


@pytest.mark.parametrize("bad_rate", ["-1", "1500"])
def test_interest_rate_out_of_range_rejected(signed_in_page: Page, bad_rate: str) -> None:
    """`MAX_RATE` is 1000% — anything beyond, or negative, must 400. The Add
    Account modal exposes the interest field only for savings/loans."""
    page = signed_in_page

    dialogs: list[Dialog] = []
    page.on("dialog", lambda d: (dialogs.append(d), d.accept()))

    page.locator("#btn-add-account").click()
    page.locator("#add-account-modal").wait_for(state="visible")
    page.locator("#add-name").fill(f"Sketchy Rate {bad_rate}")
    page.locator("#add-type").select_option("savings")
    page.locator("#add-interest-group").wait_for(state="visible")
    # Use JS to set the value so the browser's min/max constraint doesn't strip it.
    page.locator("#add-interest").evaluate("(el, v) => { el.value = v; }", bad_rate)
    page.locator("#add-account-modal button.btn-primary").click()

    page.wait_for_timeout(400)
    assert dialogs, "expected an Error alert when interest rate is out of range"
    assert dialogs[-1].message.lower().startswith("error:"), dialogs[-1].message
