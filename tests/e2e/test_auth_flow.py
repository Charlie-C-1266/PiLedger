"""Sign-up / sign-in / sign-out flow exercised through the browser."""
from __future__ import annotations

import re

from playwright.sync_api import Page, expect


def test_unauthenticated_root_redirects_to_login(page: Page) -> None:
    page.goto("/")
    expect(page).to_have_url(re.compile(r".*/login$"))
    expect(page.locator("#login-username")).to_be_visible()


def test_register_then_auto_login_lands_on_dashboard(page: Page, unique_user) -> None:
    page.goto("/login")
    page.locator("#tab-register").click()
    page.locator("#reg-username").fill(unique_user["username"])
    page.locator("#reg-password").fill(unique_user["password"])
    page.locator("#reg-confirm").fill(unique_user["password"])
    page.locator("#reg-btn").click()

    page.wait_for_url(re.compile(r".*/$"))
    expect(page.locator("#header-username")).to_have_text(unique_user["username"])
    expect(page.locator("#total-amount")).to_be_visible()


def test_register_with_mismatched_passwords_blocks_submit(page: Page, unique_user) -> None:
    page.goto("/login")
    page.locator("#tab-register").click()
    page.locator("#reg-username").fill(unique_user["username"])
    page.locator("#reg-password").fill(unique_user["password"])
    page.locator("#reg-confirm").fill("totally-different")
    page.locator("#reg-btn").click()

    expect(page.locator("#reg-error")).to_have_text("Passwords do not match")
    # And we should still be on /login, not bounced to the dashboard.
    expect(page).to_have_url(re.compile(r".*/login$"))


def test_login_with_wrong_password_shows_error(page: Page, registered_user) -> None:
    page.goto("/login")
    page.locator("#login-username").fill(registered_user["username"])
    page.locator("#login-password").fill("not-the-real-one")
    page.locator("#login-btn").click()

    err = page.locator("#login-error")
    expect(err).not_to_be_empty()
    expect(page).to_have_url(re.compile(r".*/login$"))


def test_logout_clears_session_and_returns_to_login(signed_in_page: Page) -> None:
    signed_in_page.get_by_role("button", name="Sign out").click()
    signed_in_page.wait_for_url(re.compile(r".*/login$"))

    # Going back to / should bounce again — the cookie really is gone.
    signed_in_page.goto("/")
    signed_in_page.wait_for_url(re.compile(r".*/login$"))
