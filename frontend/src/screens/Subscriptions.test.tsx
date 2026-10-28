import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Subscription } from "../types";

vi.mock("../hooks/useSubscriptions", () => ({
  useSubscriptions: vi.fn(),
  useOccurrences: vi.fn(),
}));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));
vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
// Heavy children — exercised by their own tests; stub here so the screen test
// stays focused on list rendering and the view toggle.
vi.mock("../components/SubscriptionsCalendar", () => ({
  default: ({ filter }: { filter?: unknown }) => (
    <div data-testid="calendar-view" data-filter={JSON.stringify(filter)} />
  ),
}));
vi.mock("../components/AddSubscriptionModal", () => ({
  default: () => <div data-testid="add-modal" />,
}));

import Subscriptions from "./Subscriptions";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useSummary } from "../hooks/useSummary";
import { useAccounts } from "../hooks/useAccounts";
import type { Account } from "../types";

function makeSub(over: Partial<Subscription>): Subscription {
  return {
    id: 1,
    user_id: 1,
    name: "Sub",
    amount: 9.99,
    category: "",
    kind: "expense",
    account_id: null,
    account_name: null,
    to_account_id: null,
    to_account_name: null,
    frequency: "monthly",
    start_date: "2024-01-15",
    end_date: null,
    color: "",
    notes: "",
    active: true,
    next_due_date: "2026-07-01",
    created_at: "2024-01-01T00:00:00Z",
    ...over,
  };
}

function setAccounts(accounts: Pick<Account, "id" | "name" | "closed">[]) {
  vi.mocked(useAccounts).mockReturnValue({
    data: accounts,
  } as ReturnType<typeof useAccounts>);
}

function setSubs(subs: Subscription[]) {
  setAccounts([
    { id: 1, name: "Current", closed: false },
    { id: 2, name: "Savings", closed: false },
  ]);
  vi.mocked(useSubscriptions).mockReturnValue({
    data: subs,
  } as ReturnType<typeof useSubscriptions>);
  vi.mocked(useSummary).mockReturnValue({
    data: { base_currency: "GBP" },
  } as ReturnType<typeof useSummary>);
}

/** Shows the current query string, so a test can check what the filter wrote. */
function LocationProbe() {
  return <div data-testid="location">{useLocation().search}</div>;
}

function renderScreen(url = "/scheduled") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider>
        <Subscriptions />
        <LocationProbe />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe("Scheduled screen", () => {
  it("is titled Scheduled with an Add scheduled item button", () => {
    setSubs([]);
    renderScreen();
    expect(
      screen.getByRole("heading", { level: 1, name: "Scheduled" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Add scheduled item" })
    ).toBeInTheDocument();
  });

  it("shows income as a plus amount in the up colour", () => {
    setSubs([
      makeSub({ id: 1, name: "Salary", kind: "income", amount: 2500 }),
      makeSub({ id: 2, name: "Netflix", kind: "expense", amount: 9.99 }),
    ]);
    renderScreen();
    const income = screen.getByText("+£2,500.00");
    expect(income.className).toMatch(/amountUp/);
    const payment = screen.getByText("−£9.99");
    expect(payment.className).not.toMatch(/amountUp/);
  });

  it("marks a transfer with the transfer icon and both accounts", () => {
    setSubs([
      makeSub({
        name: "Savings pot",
        kind: "transfer",
        amount: 200,
        account_id: 1,
        account_name: "Current",
        to_account_id: 2,
        to_account_name: "Savings",
      }),
    ]);
    renderScreen();
    expect(screen.getByRole("img", { name: "Transfer" })).toBeInTheDocument();
    expect(screen.getByText("Current → Savings")).toBeInTheDocument();
    // A transfer only moves money between your own accounts: no sign.
    expect(screen.getByText("£200.00").className).not.toMatch(/amountUp/);
  });

  it("renders the subscriptions in the order the server returned them", () => {
    setSubs([
      makeSub({ id: 1, name: "Netflix", next_due_date: "2026-07-01" }),
      makeSub({ id: 2, name: "Spotify", next_due_date: "2026-07-20" }),
    ]);
    renderScreen();
    const names = screen.getAllByText(/Netflix|Spotify/);
    expect(names[0]).toHaveTextContent("Netflix");
    expect(names[1]).toHaveTextContent("Spotify");
  });

  it("shows the empty state when nothing is scheduled", () => {
    setSubs([]);
    renderScreen();
    expect(screen.getByText(/Nothing scheduled yet/i)).toBeInTheDocument();
  });

  it("switches from the list to the calendar view via the toggle", async () => {
    setSubs([makeSub({ name: "Netflix" })]);
    renderScreen();

    // List is the default view.
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-view")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Calendar" }));

    expect(screen.getByTestId("calendar-view")).toBeInTheDocument();
    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
  });

  it("labels an active subscription with its days-until-due pill", () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    setSubs([makeSub({ name: "Gym", next_due_date: future.toISOString().slice(0, 10) })]);
    renderScreen();
    expect(screen.getByText("Due in 3 days")).toBeInTheDocument();
  });

  it("labels a paused subscription as paused", () => {
    setSubs([makeSub({ name: "Old", active: false, next_due_date: null })]);
    renderScreen();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("badges automatic items Auto and leaves reminders unbadged", () => {
    setSubs([
      makeSub({ id: 1, name: "Rent", account_id: 1, auto_post: true }),
      makeSub({ id: 2, name: "Gym", account_id: 1, auto_post: false }),
    ]);
    renderScreen();
    const badges = screen.getAllByText("Auto");
    expect(badges).toHaveLength(1);
    expect(screen.getByText("Rent").closest("[class*=card]")).toContainElement(
      badges[0]
    );
  });

  it("warns when an automatic item's account is closed", () => {
    setSubs([
      makeSub({ id: 1, name: "Rent", account_id: 3, auto_post: true }),
      makeSub({ id: 2, name: "Gym", account_id: 3, auto_post: false }),
    ]);
    setAccounts([{ id: 3, name: "Old bank", closed: true }]);
    renderScreen();
    // Only the automatic one: a reminder never posts, so there's nothing to warn about.
    expect(screen.getAllByText("Won't post: Old bank is closed")).toHaveLength(1);
  });

  it("warns about a closed destination on an automatic transfer", () => {
    setSubs([
      makeSub({
        name: "Savings pot",
        kind: "transfer",
        account_id: 1,
        account_name: "Current",
        to_account_id: 3,
        to_account_name: "Old bank",
        auto_post: true,
      }),
    ]);
    setAccounts([
      { id: 1, name: "Current", closed: false },
      { id: 3, name: "Old bank", closed: true },
    ]);
    renderScreen();
    expect(screen.getByText("Won't post: Old bank is closed")).toBeInTheDocument();
  });
});

describe("Scheduled screen filters", () => {
  const ITEMS = [
    makeSub({ id: 1, name: "Netflix", kind: "expense", account_id: 1, account_name: "Current" }),
    makeSub({ id: 2, name: "Salary", kind: "income", account_id: 1, account_name: "Current" }),
    makeSub({
      id: 3,
      name: "Savings pot",
      kind: "transfer",
      account_id: 1,
      account_name: "Current",
      to_account_id: 2,
      to_account_name: "Savings",
    }),
    makeSub({ id: 4, name: "Gym", kind: "expense", account_id: null }),
  ];

  const names = () =>
    ["Netflix", "Salary", "Savings pot", "Gym"].filter((n) => screen.queryByText(n));

  const accountSelect = () => screen.getByRole("combobox", { name: "Account" });

  it("shows everything until a filter is chosen", () => {
    setSubs(ITEMS);
    renderScreen();
    expect(names()).toEqual(["Netflix", "Salary", "Savings pot", "Gym"]);
    expect(accountSelect()).toHaveValue("");
    expect(screen.getByRole("radio", { name: "All types" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("offers the same types as the add form", () => {
    setSubs(ITEMS);
    renderScreen();
    const types = within(screen.getByRole("radiogroup", { name: "Type" }));
    expect(types.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "All types",
      "Payment",
      "Income",
      "Transfer",
    ]);
  });

  it("narrows the list to one type and records it in the URL", async () => {
    setSubs(ITEMS);
    renderScreen();
    await userEvent.click(screen.getByRole("radio", { name: "Income" }));
    expect(names()).toEqual(["Salary"]);
    expect(screen.getByTestId("location")).toHaveTextContent("?type=income");
  });

  it("narrows the list to one account, including transfers into it", async () => {
    setSubs(ITEMS);
    renderScreen();
    await userEvent.selectOptions(accountSelect(), "Savings");
    // Only the transfer touches Savings: it arrives there.
    expect(names()).toEqual(["Savings pot"]);
    expect(screen.getByTestId("location")).toHaveTextContent("?account=2");
  });

  it("combines the account and type filters", async () => {
    setSubs(ITEMS);
    renderScreen();
    await userEvent.selectOptions(accountSelect(), "Current");
    await userEvent.click(screen.getByRole("radio", { name: "Payment" }));
    // Gym is a payment too, but has no account.
    expect(names()).toEqual(["Netflix"]);
  });

  it("only offers accounts that have something scheduled", () => {
    setSubs(ITEMS);
    setAccounts([
      { id: 1, name: "Current", closed: false },
      { id: 2, name: "Savings", closed: false },
      { id: 5, name: "ISA", closed: false },
    ]);
    renderScreen();
    const options = within(accountSelect()).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["All accounts", "Current", "Savings"]);
  });

  it("marks a closed account in the account picker", () => {
    setSubs([makeSub({ name: "Rent", account_id: 3, account_name: "Old bank" })]);
    setAccounts([{ id: 3, name: "Old bank", closed: true }]);
    renderScreen();
    expect(within(accountSelect()).getByRole("option", { name: "Old bank (closed)" })).toBeInTheDocument();
  });

  it("opens already filtered from a link", () => {
    setSubs(ITEMS);
    renderScreen("/scheduled?account=2&type=transfer");
    expect(names()).toEqual(["Savings pot"]);
    expect(accountSelect()).toHaveValue("2");
    expect(screen.getByRole("radio", { name: "Transfer" })).toBeChecked();
  });

  it("ignores a link to an account that doesn't exist", () => {
    setSubs(ITEMS);
    renderScreen("/scheduled?account=99");
    expect(names()).toEqual(["Netflix", "Salary", "Savings pot", "Gym"]);
    expect(accountSelect()).toHaveValue("");
  });

  it("says when nothing matches, and Clear filters brings everything back", async () => {
    setSubs(ITEMS);
    renderScreen("/scheduled?account=2&type=income");
    expect(names()).toEqual([]);
    expect(screen.getByText("Nothing scheduled matches these filters.")).toBeInTheDocument();
    // This isn't the empty-account message: there are items, just not these.
    expect(screen.queryByText(/Nothing scheduled yet/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(names()).toEqual(["Netflix", "Salary", "Savings pot", "Gym"]);
    expect(screen.getByTestId("location")).toHaveTextContent(/^$/);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("hands the same filter to the calendar", async () => {
    setSubs(ITEMS);
    renderScreen("/scheduled?account=1");
    await userEvent.click(screen.getByRole("radio", { name: "Calendar" }));
    await userEvent.click(screen.getByRole("radio", { name: "Payment" }));
    expect(JSON.parse(screen.getByTestId("calendar-view").dataset.filter!)).toEqual({
      account: 1,
      kind: "expense",
    });
  });

  it("hides the filters while nothing is scheduled", () => {
    setSubs([]);
    renderScreen();
    expect(screen.queryByRole("group", { name: "Filter scheduled items" })).not.toBeInTheDocument();
  });
});
