"""
Theme + dark mode settings must survive across sessions for the same user.

Coverage:
* Changing the theme/mode immediately rewrites `data-theme` / `data-mode` on
  `<html>` and mirrors to localStorage (avoiding the FOUC on next paint).
* After signing out and signing back in, the server-side preference is what
  re-applies — proven by clearing localStorage between sessions, so any
  persistence must come from the API round-trip.
* `/api/prefs` reflects the change for a third-party (curl-style) consumer.
"""
from __future__ import annotations

import re

import requests
from playwright.sync_api import Page, expect


def _open_settings(page: Page) -> None:
    page.locator("#btn-open-settings").click()
    page.locator("#settings-modal").wait_for(state="visible")


def _close_settings(page: Page) -> None:
    page.locator("#settings-modal").get_by_role("button", name="Done").click()
    page.locator("#settings-modal").wait_for(state="hidden")


def test_theme_change_updates_html_attribute_and_localstorage(signed_in_page: Page) -> None:
    page = signed_in_page

    # Default theme is olive.
    expect(page.locator("html")).to_have_attribute("data-theme", "olive")

    _open_settings(page)
    page.locator(".theme-swatch[data-theme-id='rose']").click()
    _close_settings(page)

    expect(page.locator("html")).to_have_attribute("data-theme", "rose")

    stored_theme = page.evaluate("() => localStorage.getItem('piledger:theme')")
    assert stored_theme == "rose"


def test_dark_mode_toggle_persists_attribute_and_localstorage(signed_in_page: Page) -> None:
    page = signed_in_page

    expect(page.locator("html")).not_to_have_attribute("data-mode", "dark")

    page.locator("#btn-toggle-mode").click()
    expect(page.locator("html")).to_have_attribute("data-mode", "dark")

    stored_dark = page.evaluate("() => localStorage.getItem('piledger:dark')")
    assert stored_dark == "1"


def test_prefs_persist_across_sessions(page: Page, registered_user, live_server) -> None:
    """The high-value test: settings really do follow the *user account*, not
    just the browser's localStorage. We wipe localStorage between sessions to
    prove the server is doing the persisting."""
    # Session 1: sign in, switch to indigo + dark, sign out.
    page.goto("/login")
    page.locator("#login-username").fill(registered_user["username"])
    page.locator("#login-password").fill(registered_user["password"])
    page.locator("#login-btn").click()
    page.wait_for_url(re.compile(r".*/$"))
    page.locator("#header-username").wait_for(state="visible")

    _open_settings(page)
    page.locator(".theme-swatch[data-theme-id='indigo']").click()
    page.locator("#settings-mode-pill button[data-mode='dark']").click()
    _close_settings(page)

    expect(page.locator("html")).to_have_attribute("data-theme", "indigo")
    expect(page.locator("html")).to_have_attribute("data-mode", "dark")

    # Server-side state matches.
    cookies = page.context.cookies()
    cookie_jar = {c["name"]: c["value"] for c in cookies}
    r = requests.get(
        f"{live_server}/api/prefs",
        cookies=cookie_jar,
        timeout=5,
    )
    assert r.status_code == 200
    # Subset check: prefs response also carries base_currency (added in v0.11);
    # this test only cares about theme + dark_mode persistence here.
    assert {"theme": "indigo", "dark_mode": True}.items() <= r.json().items()

    page.get_by_role("button", name="Sign out").click()
    page.wait_for_url(re.compile(r".*/login$"))

    # Clear localStorage so the dashboard cannot cheat on re-load — any theme
    # that comes back must have come from /api/prefs.
    page.evaluate("() => localStorage.clear()")

    # Session 2: sign back in. The dashboard should re-hydrate from the API.
    page.locator("#login-username").fill(registered_user["username"])
    page.locator("#login-password").fill(registered_user["password"])
    page.locator("#login-btn").click()
    page.wait_for_url(re.compile(r".*/$"))
    page.locator("#header-username").wait_for(state="visible")

    # `applyTheme()` runs after `loadPrefs()`, which is awaited before the
    # first paint of the dashboard, so the attributes should be set by the
    # time we look. Allow a moment for the fetch to land.
    expect(page.locator("html")).to_have_attribute("data-theme", "indigo")
    expect(page.locator("html")).to_have_attribute("data-mode", "dark")

    # localStorage was re-populated by applyTheme on the way through.
    stored_theme = page.evaluate("() => localStorage.getItem('piledger:theme')")
    stored_dark = page.evaluate("() => localStorage.getItem('piledger:dark')")
    assert stored_theme == "indigo"
    assert stored_dark == "1"


def test_theme_swatch_marks_active_palette(signed_in_page: Page) -> None:
    """The settings modal highlights the currently active theme. Switching
    must move the `active` class to the new swatch."""
    page = signed_in_page

    _open_settings(page)
    expect(page.locator(".theme-swatch[data-theme-id='olive']")).to_have_class(
        re.compile(r"\bactive\b")
    )

    page.locator(".theme-swatch[data-theme-id='slate']").click()
    expect(page.locator(".theme-swatch[data-theme-id='slate']")).to_have_class(
        re.compile(r"\bactive\b")
    )
    expect(page.locator(".theme-swatch[data-theme-id='olive']")).not_to_have_class(
        re.compile(r"\bactive\b")
    )
