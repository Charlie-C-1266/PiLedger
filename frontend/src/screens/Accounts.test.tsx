import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Account } from "../types";

vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));
vi.mock("../hooks/useAllHistory", () => ({ useAllHistory: vi.fn() }));
// Heavy children with their own tests — stubbed so this stays about the list.
vi.mock("../components/CardStack", () => ({ default: () => <div data-testid="stack" /> }));
vi.mock("../components/charts/AccountHistoryChart", () => ({
  default: () => <div data-testid="history-chart" />,
}));
vi.mock("../components/EditAccountModal", () => ({
  default: () => <div data-testid="edit-modal" />,
}));

import Accounts from "./Accounts";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { useAllHistory } from "../hooks/useAllHistory";

function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 1,
    user_id: 1,
    name: "Everyday",
    type: "current",
    subtype: "general",
    institution: null,
    institution_name: null,
    currency: "GBP",
    interest_rate: 0,
    color: "#6366f1",
    counts_to_net_worth: true,
    closed: false,
    created_at: "2026-01-01T00:00:00Z",
    current_balance: 100,
    last_updated: null,
    ...over,
  };
}

function renderAccounts(accounts: Account[]) {
  // Minimal shapes — the screen only reads `.data` and `.isPending` off each hook.
  vi.mocked(useAccounts).mockReturnValue({ data: accounts } as never);
  vi.mocked(useSummary).mockReturnValue({
    data: { base_currency: "GBP" },
  } as never);
  vi.mocked(useAllHistory).mockReturnValue({ data: [], isPending: false } as never);
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Accounts />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const CHASE_CURRENT = makeAccount({
  id: 1,
  name: "Everyday",
  institution: "chase",
  current_balance: 1000,
});
const CHASE_CARD = makeAccount({
  id: 2,
  name: "Chase Card",
  type: "credit",
  institution: "chase",
  current_balance: 200,
});
const MONZO = makeAccount({
  id: 3,
  name: "Monzo Pot",
  type: "savings",
  institution: "monzo",
  current_balance: 500,
});

describe("Accounts institution grouping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists accounts ungrouped by default", async () => {
    renderAccounts([CHASE_CURRENT, MONZO]);
    expect(screen.queryByText("1 account")).not.toBeInTheDocument();
  });

  it("collects accounts held with the same institution under one heading", async () => {
    renderAccounts([CHASE_CURRENT, CHASE_CARD, MONZO]);
    await userEvent.click(screen.getByRole("button", { name: "By institution" }));

    // Two Chase accounts under one heading, Monzo's one under its own.
    expect(screen.getByText("2 accounts")).toBeInTheDocument();
    expect(screen.getByText("1 account")).toBeInTheDocument();
  });

  it("nets debts off the institution total", async () => {
    const { container } = renderAccounts([CHASE_CURRENT, CHASE_CARD]);
    await userEvent.click(screen.getByRole("button", { name: "By institution" }));

    // £1,000 current − £200 on the credit card held with the same provider.
    // Scoped to the group: the page's own net-worth figure is the same number.
    const group = container.querySelector("section") as HTMLElement;
    expect(within(group).getByText("£800.00")).toBeInTheDocument();
  });

  it("puts accounts with no institution in a trailing group", async () => {
    renderAccounts([makeAccount({ id: 9, name: "Cash tin" }), CHASE_CURRENT]);
    await userEvent.click(screen.getByRole("button", { name: "By institution" }));

    const headings = screen
      .getAllByText(/^(Chase|No institution)$/)
      .map((el) => el.textContent);
    expect(headings[headings.length - 1]).toBe("No institution");
  });

  it("groups two spellings of one custom institution together", async () => {
    renderAccounts([
      makeAccount({ id: 4, institution: "other", institution_name: "Kroo" }),
      makeAccount({ id: 5, institution: "other", institution_name: "kroo" }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "By institution" }));
    expect(screen.getByText("2 accounts")).toBeInTheDocument();
  });

  it("respects the assets/debts filter while grouped", async () => {
    renderAccounts([CHASE_CURRENT, CHASE_CARD, MONZO]);
    await userEvent.click(screen.getByRole("button", { name: "By institution" }));
    await userEvent.click(screen.getByRole("button", { name: "Debts" }));

    expect(screen.queryByText("Monzo")).not.toBeInTheDocument();
    expect(screen.getByText("1 account")).toBeInTheDocument();
  });

  it("returns to the flat list when List is chosen again", async () => {
    renderAccounts([CHASE_CURRENT, MONZO]);
    await userEvent.click(screen.getByRole("button", { name: "By institution" }));
    expect(screen.getAllByText("1 account")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByText("1 account")).not.toBeInTheDocument();
  });

  it("keeps every account visible when grouped", async () => {
    const { container } = renderAccounts([CHASE_CURRENT, CHASE_CARD, MONZO]);
    await userEvent.click(screen.getByRole("button", { name: "By institution" }));

    for (const name of ["Everyday", "Chase Card", "Monzo Pot"]) {
      expect(within(container).getByText(name)).toBeInTheDocument();
    }
  });
});
