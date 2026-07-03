import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Account } from "../../types";

vi.mock("../../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
vi.mock("../../hooks/useSummary", () => ({ useSummary: vi.fn() }));

import DistributionDonut from "./DistributionDonut";
import { useAccounts } from "../../hooks/useAccounts";
import { useSummary } from "../../hooks/useSummary";

function makeAccount(over: Partial<Account>): Account {
  return {
    id: 1,
    user_id: 1,
    name: "Acc",
    type: "current",
    subtype: "general",
    currency: "GBP",
    interest_rate: 0,
    color: "#abcabc",
    counts_to_net_worth: true,
    closed: false,
    created_at: "2024-01-01T00:00:00Z",
    current_balance: 100,
    last_updated: null,
    ...over,
  };
}

function setAccounts(accounts: Account[]) {
  vi.mocked(useAccounts).mockReturnValue({
    data: accounts,
    isPending: false,
  } as never);
  vi.mocked(useSummary).mockReturnValue({
    data: { base_currency: "GBP" },
    isPending: false,
  } as never);
}

function renderDonut() {
  return render(
    <MemoryRouter>
      <DistributionDonut />
    </MemoryRouter>,
  );
}

describe("DistributionDonut", () => {
  it("shows the empty state when there are no asset accounts", () => {
    setAccounts([makeAccount({ type: "loan", current_balance: 5000 })]);
    renderDonut();

    expect(
      screen.getByText("No asset accounts to chart yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("Add an account")).toBeInTheDocument();
  });

  it("charts only asset accounts and totals them", () => {
    setAccounts([
      makeAccount({ id: 1, name: "Current", type: "current", current_balance: 600 }),
      makeAccount({ id: 2, name: "Savings", type: "savings", current_balance: 400 }),
      makeAccount({ id: 3, name: "Mortgage", type: "loan", current_balance: 9000 }),
    ]);
    renderDonut();

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    // Debt accounts are excluded from the asset distribution.
    expect(screen.queryByText("Mortgage")).not.toBeInTheDocument();
    // Legend total of the two asset balances.
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("£1,000.00")).toBeInTheDocument();
  });
});
