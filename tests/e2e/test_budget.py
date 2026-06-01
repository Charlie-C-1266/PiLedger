"""
End-to-end coverage for the zero-based envelope Budget screen.

Reuses the browser's session cookie to seed accounts / transactions / budget
rows via the API, then drives the real UI: building a budget through the add
modals, the live `spent` figure computed from a seeded transaction, the
period toggle rescaling every figure, and an envelope slider updating the
group total and the hero in real time.
"""

from __future__ import annotations

from playwright.sync_api import expect


def _make_account(page) -> int:
    acc = page.request.post(
        "/api/accounts", data={"name": "Checking", "type": "current", "currency": "GBP"}
    )
    assert acc.ok, acc.text()
    return acc.json()["id"]


def _spend(page, account_id: int, amount: float, category: str) -> None:
    txn = page.request.post(
        "/api/transactions",
        data={
            "account_id": account_id,
            "amount": -amount,
            "merchant": "Market",
            "category": category,
        },
    )
    assert txn.ok, txn.text()


def test_build_a_budget_and_spent_reflects_a_transaction(signed_in_page):
    page = signed_in_page
    account_id = _make_account(page)
    category = page.request.get("/api/categories").json()["defaults"][0]
    # A current-month spend in the category the envelope will track.
    _spend(page, account_id, 250, category)

    page.goto("/budget")

    # Empty state → add an income line (quick add) and a group (modal).
    page.get_by_role("button", name="Add income").click()
    page.get_by_role("button", name="Add group").click()
    page.get_by_placeholder("Group name (e.g. Bills & Housing)").fill("Everyday")
    page.get_by_role("button", name="Flexible").click()
    page.get_by_role("button", name="Save group").click()

    # Add an envelope tracking the seeded category.
    page.get_by_role("button", name="Add envelope").click()
    page.get_by_placeholder("Envelope name (e.g. Groceries)").fill("Groceries")
    page.locator("select").first.select_option(category)
    page.get_by_placeholder("Monthly budget (e.g. 300)").fill("400")
    page.get_by_role("button", name="Save envelope").click()

    # The envelope shows live spend computed from the seeded transaction.
    expect(page.get_by_text("£250 spent")).to_be_visible()
    expect(page.get_by_role("heading", name="Everyday")).to_be_visible()


def _seed_budget(page) -> str:
    account_id = _make_account(page)
    category = page.request.get("/api/categories").json()["defaults"][0]
    _spend(page, account_id, 250, category)
    page.request.post("/api/budget/income", data={"label": "Salary", "amount": 3000})
    group = page.request.post(
        "/api/budget/groups",
        data={"name": "Everyday", "color": "#D97757", "flexible": True},
    ).json()
    page.request.post(
        "/api/budget/envelopes",
        data={
            "group_id": group["id"],
            "label": "Groceries",
            "category": category,
            "budgeted": 1000,
        },
    )
    return category


def test_period_toggle_rescales_and_slider_updates_totals(signed_in_page):
    page = signed_in_page
    _seed_budget(page)
    page.goto("/budget")

    # Monthly: income 3000, allocated 1000.
    expect(page.get_by_text("£3,000").first).to_be_visible()
    expect(page.get_by_text("£1,000").first).to_be_visible()

    # Yearly rescales every figure by 12 (income 3000 → 36,000).
    page.get_by_role("radio", name="Yearly").click()
    expect(page.get_by_text("£36,000").first).to_be_visible()

    # Back to monthly, then drive the envelope slider to a new value. Set it via
    # a native input event (the reliable way to move a controlled range input)
    # so React's onChange fires exactly as a real drag would.
    page.get_by_role("radio", name="Monthly").click()
    slider = page.get_by_role("slider", name="Groceries budgeted amount")
    slider.evaluate(
        """el => {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          ).set;
          setter.call(el, '1500');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )

    # 1000 → 1500: the budgeted figure, the group total and the hero's allocated
    # stat all reflect it live (no save round-trip needed).
    expect(page.get_by_text("£1,500").first).to_be_visible()


def test_slider_ceiling_is_stable_when_dragged_to_the_top(signed_in_page):
    """Regression: the slider max used to be derived from the budget it sets, so
    dragging to the top doubled the value, which doubled the max, which let the
    next drag double again — running the figure up into the billions. The
    ceiling must instead be a stable bound (the £3,000 income here)."""
    page = signed_in_page
    _seed_budget(page)
    page.goto("/budget")

    slider = page.get_by_role("slider", name="Groceries budgeted amount")
    assert slider.get_attribute("max") == "3000"

    # Drag all the way to the top, twice — the max must not ratchet upward.
    for _ in range(2):
        slider.evaluate(
            """el => {
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              ).set;
              setter.call(el, el.max);
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }"""
        )

    assert slider.get_attribute("max") == "3000"
    expect(page.get_by_text("£3,000").first).to_be_visible()
