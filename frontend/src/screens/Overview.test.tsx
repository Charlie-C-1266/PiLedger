import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Summary } from "../types";

// Mock the data hooks so we can drive Overview with controlled summaries.
vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn(() => ({ data: [] })) }));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));
vi.mock("../hooks/useTransactions", () => ({
  useTransactions: vi.fn(() => ({ data: [] })),
}));
vi.mock("../hooks/useGoals", () => ({ useGoals: vi.fn(() => ({ data: [] })) }));
vi.mock("../hooks/useNetWorthSeries", () => ({
  useNetWorthSeries: vi.fn(() => ({ data: [] })),
}));

// Stub the recharts net-worth chart — it needs layout width that jsdom lacks and
// is irrelevant to the hero-meta colour logic under test.
vi.mock("../components/charts/LineChart", () => ({ default: () => <div /> }));

import Overview from "./Overview";
import { useSummary } from "../hooks/useSummary";

function makeSummary(over: Partial<Summary>): Summary {
  return {
    total: 800,
    total_current: 0,
    total_savings: 0,
    total_loans: 0,
    total_credit: 0,
    total_invest: 0,
    assets: 0,
    debts: 0,
    savings_rate: 10,
    set_aside: 0,
    total_net_worth: 0,
    account_count: 1,
    base_currency: "GBP",
    missing_rates: [],
    ...over,
  };
}

function renderOverview() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Overview />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

// The pill's colour comes from DeltaPill's up/down class (see
// DeltaPill.test.tsx); here it's enough that the sign picks the direction.
describe("Overview net-position pill (H7)", () => {
  beforeEach(() => {
    localStorage.setItem("pl-theme-mode", "light");
  });

  it("colours the pill red (down) when net position is negative", () => {
    // assets 500 − |debts 2000| = −1500
    vi.mocked(useSummary).mockReturnValue({
      data: makeSummary({ assets: 500, debts: 2000 }),
    } as ReturnType<typeof useSummary>);
    renderOverview();

    const pill = screen.getByText("−£1,500.00");
    expect(pill).toHaveAttribute("data-direction", "down");
  });

  it("colours the pill green (up) when net position is positive", () => {
    // assets 3000 − |debts 500| = 2500
    vi.mocked(useSummary).mockReturnValue({
      data: makeSummary({ assets: 3000, debts: 500 }),
    } as ReturnType<typeof useSummary>);
    renderOverview();

    const pill = screen.getByText("£2,500.00");
    expect(pill).toHaveAttribute("data-direction", "up");
  });
});
