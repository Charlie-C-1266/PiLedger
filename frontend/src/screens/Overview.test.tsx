import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import { lightTokens } from "../theme/tokens";
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

// jsdom may serialise an inline hex colour as either the hex or its rgb() form;
// accept both.
function colorForms(hex: string): string[] {
  const h = hex.replace("#", "");
  const rgb = `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(
    h.slice(2, 4),
    16,
  )}, ${parseInt(h.slice(4, 6), 16)})`;
  return [hex.toLowerCase(), rgb];
}

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
    expect(colorForms(lightTokens.down)).toContain(pill.style.color);
  });

  it("colours the pill green (up) when net position is positive", () => {
    // assets 3000 − |debts 500| = 2500
    vi.mocked(useSummary).mockReturnValue({
      data: makeSummary({ assets: 3000, debts: 500 }),
    } as ReturnType<typeof useSummary>);
    renderOverview();

    const pill = screen.getByText("£2,500.00");
    expect(colorForms(lightTokens.up)).toContain(pill.style.color);
  });
});
