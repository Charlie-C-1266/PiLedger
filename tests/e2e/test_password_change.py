"""End-to-end password-change flow via the Settings modal."""
from __future__ import annotations

import re

from playwright.sync_api import Page, expect


def _open_settings(page: Page) -> None:
    page.locator("#btn-open-settings").click()
    expect(page.locator("#settings-modal")).to_have_class(re.compile(r"\bopen\b"))


def test_settings_modal_exposes_password_change_form(signed_in_page: Page) -> None:
    """The form must render with all three inputs and the action button.
    Sanity guard so an HTML refactor that drops a field is caught."""
    _open_settings(signed_in_page)
    expect(signed_in_page.locator("#pw-current")).to_be_visible()
    expect(signed_in_page.locator("#pw-new")).to_be_visible()
    expect(signed_in_page.locator("#pw-confirm")).to_be_visible()
    expect(signed_in_page.locator("#pw-status")).to_have_text("")


def test_password_mismatch_shows_inline_error(signed_in_page: Page, registered_user) -> None:
    _open_settings(signed_in_page)
    signed_in_page.locator("#pw-current").fill(registered_user["password"])
    signed_in_page.locator("#pw-new").fill("newpassword123")
    signed_in_page.locator("#pw-confirm").fill("different456")
    signed_in_page.get_by_role("button", name="Update Password").click()

    status = signed_in_page.locator("#pw-status")
    expect(status).to_have_text("New password and confirmation do not match.")
    expect(status).to_have_class(re.compile(r"\berror\b"))


def test_wrong_current_password_shows_inline_error(signed_in_page: Page) -> None:
    """A wrong current password must surface inline rather than kick the user
    to /login (which would happen if the handler used the auto-redirecting
    apiFetch wrapper)."""
    _open_settings(signed_in_page)
    signed_in_page.locator("#pw-current").fill("definitely-not-the-real-one")
    signed_in_page.locator("#pw-new").fill("newpassword123")
    signed_in_page.locator("#pw-confirm").fill("newpassword123")
    signed_in_page.get_by_role("button", name="Update Password").click()

    status = signed_in_page.locator("#pw-status")
    expect(status).to_have_text("Current password is incorrect.")
    expect(status).to_have_class(re.compile(r"\berror\b"))
    # And the user is still on the dashboard, not bounced to /login.
    expect(signed_in_page).to_have_url(re.compile(r".*/$"))
    expect(signed_in_page.locator("#header-username")).to_be_visible()


def test_password_change_succeeds_and_new_password_works_on_relogin(
    signed_in_page: Page, registered_user
) -> None:
    """Full round-trip: change the password, sign out, sign in again with the
    new password. The original password must be rejected on the second login
    attempt — proves the change really persisted server-side."""
    new_password = registered_user["password"] + "X"

    _open_settings(signed_in_page)
    signed_in_page.locator("#pw-current").fill(registered_user["password"])
    signed_in_page.locator("#pw-new").fill(new_password)
    signed_in_page.locator("#pw-confirm").fill(new_password)
    signed_in_page.get_by_role("button", name="Update Password").click()

    status = signed_in_page.locator("#pw-status")
    expect(status).to_have_text(re.compile(r"Password updated"))
    expect(status).to_have_class(re.compile(r"\bok\b"))

    # Close the modal, sign out, sign back in with the new password.
    signed_in_page.locator("#settings-modal .modal-footer-right button").click()
    signed_in_page.get_by_role("button", name="Sign out").click()
    signed_in_page.wait_for_url(re.compile(r".*/login$"))

    # Old password must now fail.
    signed_in_page.locator("#login-username").fill(registered_user["username"])
    signed_in_page.locator("#login-password").fill(registered_user["password"])
    signed_in_page.locator("#login-btn").click()
    expect(signed_in_page.locator("#login-error")).not_to_be_empty()
    expect(signed_in_page).to_have_url(re.compile(r".*/login$"))

    # New password must succeed.
    signed_in_page.locator("#login-username").fill(registered_user["username"])
    signed_in_page.locator("#login-password").fill(new_password)
    signed_in_page.locator("#login-btn").click()
    signed_in_page.wait_for_url(re.compile(r".*/$"))
    expect(signed_in_page.locator("#header-username")).to_have_text(registered_user["username"])
