"""
Verify that every static SVG icon shipped in `index.html` actually renders.

These tests guard against two regression modes:

1. The icon was removed or renamed in markup (selector misses).
2. The icon is in the DOM but its parent is `display:none` or it has zero size —
   which happens silently if a CSS refactor breaks the layout (a button shows
   no glyph but is still "in the DOM"). We assert each icon has a real
   bounding box so a collapsed-but-present icon still fails the test.
"""
from __future__ import annotations

from playwright.sync_api import Page, expect


def _assert_icon_visible_and_sized(page: Page, selector: str) -> None:
    locator = page.locator(selector)
    expect(locator).to_be_visible()
    box = locator.bounding_box()
    assert box is not None, f"{selector!r} has no bounding box"
    assert box["width"] > 0 and box["height"] > 0, (
        f"{selector!r} rendered at zero size: {box}"
    )


def test_header_icons_render(signed_in_page: Page) -> None:
    page = signed_in_page
    # Logo (header), theme toggle, and settings cog all live in the header.
    _assert_icon_visible_and_sized(page, ".logo svg")
    _assert_icon_visible_and_sized(page, "#btn-toggle-mode svg.icon-moon")
    _assert_icon_visible_and_sized(page, "#btn-open-settings svg")


def test_summary_card_icons_render(signed_in_page: Page) -> None:
    page = signed_in_page
    # Each of the four summary cards has a unique icon class.
    for icon_class in ("sc-savings", "sc-current", "sc-loans", "sc-count"):
        _assert_icon_visible_and_sized(page, f".{icon_class} svg")


def test_empty_state_icon_renders_when_no_accounts(signed_in_page: Page) -> None:
    page = signed_in_page
    # A freshly registered user has no accounts, so the empty-state placeholder
    # (with its own SVG) should be present.
    empty = page.locator(".empty-state")
    expect(empty).to_be_visible()
    _assert_icon_visible_and_sized(page, ".empty-state svg")


def test_login_page_logo_renders(page: Page) -> None:
    page.goto("/login")
    _assert_icon_visible_and_sized(page, ".login-logo svg")


def test_dark_mode_swaps_sun_icon_into_view(signed_in_page: Page) -> None:
    """The dark-mode toggle holds both a moon and a sun SVG; CSS swaps them
    based on `data-mode`. In light mode the moon is shown; once we flip to
    dark, the sun becomes visible."""
    page = signed_in_page

    # Sanity: start in light mode.
    expect(page.locator("html")).not_to_have_attribute("data-mode", "dark")
    moon = page.locator("#btn-toggle-mode svg.icon-moon")
    sun = page.locator("#btn-toggle-mode svg.icon-sun")
    expect(moon).to_be_visible()
    expect(sun).to_be_hidden()

    page.locator("#btn-toggle-mode").click()
    expect(page.locator("html")).to_have_attribute("data-mode", "dark")
    # In dark mode the sun should now be visible.
    expect(sun).to_be_visible()
    expect(moon).to_be_hidden()
