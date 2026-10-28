import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Account, Subscription, SubscriptionOccurrence } from "../types";
import type { ScheduledFilter } from "../lib/scheduled";

vi.mock("../hooks/useSubscriptions", () => ({
  useOccurrences: vi.fn(),
  useSubscriptions: vi.fn(),
}));
vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));

import SubscriptionsCalendar from "./SubscriptionsCalendar";
import { useOccurrences, useSubscriptions } from "../hooks/useSubscriptions";
import { useAccounts } from "../hooks/useAccounts";

function isoKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function setOccurrences(occ: SubscriptionOccurrence[]) {
  vi.mocked(useOccurrences).mockReturnValue({
    data: occ,
  } as ReturnType<typeof useOccurrences>);
}

/** The items behind the occurrences (only what the calendar reads) and the
 * accounts, defaulting to none: every occurrence is then a plain reminder. */
function setItems(
  items: Pick<Subscription, "id" | "auto_post">[] = [],
  accounts: Pick<Account, "id" | "name" | "closed">[] = []
) {
  vi.mocked(useSubscriptions).mockReturnValue({
    data: items,
  } as ReturnType<typeof useSubscriptions>);
  vi.mocked(useAccounts).mockReturnValue({
    data: accounts,
  } as ReturnType<typeof useAccounts>);
}

beforeEach(() => setItems());

function occurrence(over: Partial<SubscriptionOccurrence>): SubscriptionOccurrence {
  return {
    date: isoKey(new Date()),
    subscription_id: 1,
    name: "Rent",
    amount: 900,
    color: "#5546F6",
    kind: "expense",
    account_id: 1,
    status: null,
    ...over,
  };
}

function renderCalendar(filter?: ScheduledFilter) {
  return render(
    <ThemeProvider>
      <SubscriptionsCalendar currency="GBP" filter={filter} />
    </ThemeProvider>
  );
}

describe("SubscriptionsCalendar", () => {
  it("renders a badge on a day that has an occurrence", () => {
    const today = isoKey(new Date());
    setOccurrences([
      { date: today, subscription_id: 1, name: "Netflix", amount: 9.99, color: "#5546F6", kind: "expense" },
    ]);
    renderCalendar();
    // The day cell exposes the occurrence count in its accessible name.
    expect(
      screen.getByRole("gridcell", { name: /1 scheduled item/i })
    ).toBeInTheDocument();
  });

  it("opens a popover listing the day's payments when a dotted day is clicked", async () => {
    const today = isoKey(new Date());
    setOccurrences([
      { date: today, subscription_id: 1, name: "Netflix", amount: 9.99, color: "#5546F6", kind: "expense" },
    ]);
    renderCalendar();
    await userEvent.click(screen.getByRole("gridcell", { name: /1 scheduled item/i }));
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("−£9.99")).toBeInTheDocument();
  });

  it("shows income in the up colour and marks transfers in the day popover", async () => {
    const today = isoKey(new Date());
    setOccurrences([
      { date: today, subscription_id: 1, name: "Salary", amount: 2500, color: "", kind: "income", account_id: 1 },
      { date: today, subscription_id: 2, name: "Savings pot", amount: 200, color: "", kind: "transfer", account_id: 1, to_account_id: 2 },
    ]);
    renderCalendar();
    await userEvent.click(screen.getByRole("gridcell", { name: /2 scheduled items/i }));
    expect(screen.getByText("+£2,500.00").className).toMatch(/amountUp/);
    expect(screen.getByText("£200.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Transfer" })).toBeInTheDocument();
  });

  it("changes the displayed month when navigating forward", async () => {
    setOccurrences([]);
    renderCalendar();
    const grid = screen.getByRole("grid");
    const before = grid.getAttribute("aria-label");
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("grid").getAttribute("aria-label")).not.toBe(before);
  });

  it("counts posted and skipped occurrences in the day's label", () => {
    setOccurrences([
      occurrence({ subscription_id: 1, name: "Rent", status: "posted" }),
      occurrence({ subscription_id: 2, name: "Gym", status: "skipped" }),
      occurrence({ subscription_id: 3, name: "Netflix", status: null }),
    ]);
    renderCalendar();
    expect(
      screen.getByRole("gridcell", {
        name: /3 scheduled items, 1 posted, 1 skipped$/,
      })
    ).toBeInTheDocument();
  });

  it("reads a posted occurrence as done and strikes a skipped one in the popover", async () => {
    setOccurrences([
      occurrence({ subscription_id: 1, name: "Rent", status: "posted" }),
      occurrence({ subscription_id: 2, name: "Gym", amount: 30, status: "skipped" }),
    ]);
    renderCalendar();
    await userEvent.click(screen.getByRole("gridcell", { name: /2 scheduled items/ }));

    expect(screen.getByText("Posted")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    // The skipped row is muted and struck through; the posted one isn't.
    const skippedRow = screen.getByText("Gym").closest("[class*=popoverRow]");
    expect(skippedRow?.className).toMatch(/popoverSkipped/);
    const postedRow = screen.getByText("Rent").closest("[class*=popoverRow]");
    expect(postedRow?.className).not.toMatch(/popoverSkipped/);
  });

  it("badges automatic items Auto in the popover, and not reminders", async () => {
    setItems([
      { id: 1, auto_post: true },
      { id: 2, auto_post: false },
    ]);
    setOccurrences([
      occurrence({ subscription_id: 1, name: "Rent" }),
      occurrence({ subscription_id: 2, name: "Gym" }),
    ]);
    renderCalendar();
    await userEvent.click(screen.getByRole("gridcell", { name: /2 scheduled items/ }));

    const badges = screen.getAllByText("Auto");
    expect(badges).toHaveLength(1);
    expect(screen.getByText("Rent")).toContainElement(badges[0]);
  });

  it("warns that an upcoming automatic occurrence won't post to a closed account", async () => {
    setItems([{ id: 1, auto_post: true }], [{ id: 1, name: "Old bank", closed: true }]);
    setOccurrences([occurrence({ subscription_id: 1, name: "Rent", account_id: 1 })]);
    renderCalendar();
    await userEvent.click(screen.getByRole("gridcell", { name: /1 scheduled item/ }));
    expect(screen.getByText("Won't post: Old bank is closed")).toBeInTheDocument();
  });
});

describe("SubscriptionsCalendar filter", () => {
  it("only marks the occurrences the filter lets through", async () => {
    setOccurrences([
      occurrence({ subscription_id: 1, name: "Rent", kind: "expense", account_id: 1 }),
      occurrence({ subscription_id: 2, name: "Salary", kind: "income", account_id: 1 }),
      occurrence({
        subscription_id: 3,
        name: "Savings pot",
        kind: "transfer",
        account_id: 1,
        to_account_id: 2,
      }),
    ]);
    renderCalendar({ account: 2, kind: "all" });
    // Only the transfer touches account 2.
    const cell = screen.getByRole("gridcell", { name: /1 scheduled item\b/ });
    await userEvent.click(cell);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Savings pot")).toBeInTheDocument();
    expect(within(dialog).queryByText("Rent")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Salary")).not.toBeInTheDocument();
  });

  it("shows every occurrence without a filter", () => {
    setOccurrences([
      occurrence({ subscription_id: 1, name: "Rent", kind: "expense" }),
      occurrence({ subscription_id: 2, name: "Salary", kind: "income" }),
    ]);
    renderCalendar();
    expect(screen.getByRole("gridcell", { name: /2 scheduled items/ })).toBeInTheDocument();
  });
});
