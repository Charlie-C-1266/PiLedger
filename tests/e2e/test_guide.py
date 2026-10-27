"""The public documentation viewer at /guide, exercised through the browser."""

from __future__ import annotations

import re

from playwright.sync_api import Page, expect


def test_old_subscriptions_link_opens_the_scheduled_guide(page: Page) -> None:
    """The Subscriptions guide was renamed Scheduled. A saved
    /guide#subscriptions link must still open it (guide.js maps the old slug),
    with its nav entry highlighted and the address updated to the new slug."""
    page.goto("/guide#subscriptions")

    content = page.locator("#guide-content")
    expect(content.get_by_role("heading", level=1)).to_have_text("Scheduled")
    expect(page.locator('.guide-nav-link[data-slug="scheduled"]')).to_have_class(
        re.compile(r"\bactive\b")
    )
    expect(page).to_have_url(re.compile(r"/guide#scheduled$"))


def test_nav_opens_the_accounts_guide(page: Page) -> None:
    page.goto("/guide")
    page.locator('.guide-nav-link[data-slug="accounts"]').click()

    content = page.locator("#guide-content")
    expect(content.get_by_role("heading", level=1)).to_have_text("Accounts")
    expect(page).to_have_url(re.compile(r"/guide#accounts$"))
