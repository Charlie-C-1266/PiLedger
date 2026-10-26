import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Subscription } from "../types";

vi.mock("../hooks/useSubscriptions", () => ({
  useSubscriptions: vi.fn(),
  useOccurrences: vi.fn(),
}));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));
// Heavy children — exercised by their own tests; stub here so the screen test
// stays focused on list rendering and the view toggle.
vi.mock("../components/SubscriptionsCalendar", () => ({
  default: () => <div data-testid="calendar-view" />,
}));
vi.mock("../components/AddSubscriptionModal", () => ({
  default: () => <div data-testid="add-modal" />,
}));

import Subscriptions from "./Subscriptions";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useSummary } from "../hooks/useSummary";

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

function setSubs(subs: Subscription[]) {
  vi.mocked(useSubscriptions).mockReturnValue({
    data: subs,
  } as ReturnType<typeof useSubscriptions>);
  vi.mocked(useSummary).mockReturnValue({
    data: { base_currency: "GBP" },
  } as ReturnType<typeof useSummary>);
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Subscriptions />
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
});
