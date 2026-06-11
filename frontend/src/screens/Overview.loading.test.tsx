import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Summary } from "../types";

vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));
vi.mock("../hooks/useTransactions", () => ({ useTransactions: vi.fn() }));
vi.mock("../hooks/useGoals", () => ({ useGoals: vi.fn() }));
vi.mock("../hooks/useNetWorthSeries", () => ({ useNetWorthSeries: vi.fn() }));

// recharts needs layout width jsdom lacks; irrelevant to loading state.
vi.mock("../components/charts/LineChart", () => ({ default: () => <div /> }));

import Overview from "./Overview";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { useTransactions } from "../hooks/useTransactions";
import { useGoals } from "../hooks/useGoals";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";

function loadedSummary(): Summary {
  return {
    total: 1234.56,
    total_current: 0,
    total_savings: 0,
    total_loans: 0,
    total_credit: 0,
    total_invest: 0,
    assets: 1000,
    debts: 0,
    savings_rate: 0,
    set_aside: 0,
    total_net_worth: 1234.56,
    account_count: 0,
    base_currency: "GBP",
    missing_rates: [],
  };
}

// Minimal shapes — Overview only reads `.data` and `.isPending` off each hook.
function setPending(pending: boolean, data: unknown) {
  const result = { data, isPending: pending } as never;
  vi.mocked(useAccounts).mockReturnValue(result);
  vi.mocked(useSummary).mockReturnValue(result);
  vi.mocked(useTransactions).mockReturnValue(result);
  vi.mocked(useGoals).mockReturnValue(result);
  vi.mocked(useNetWorthSeries).mockReturnValue(result);
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

describe("Overview loading state (H1)", () => {
  beforeEach(() => {
    localStorage.setItem("pl-theme-mode", "light");
  });

  it("shows skeletons and no fake £0.00 hero while data is loading", () => {
    setPending(true, undefined);
    renderOverview();

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    // The misleading zero values the review flagged must not appear.
    expect(screen.queryByText("£0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows real values and no skeletons once data has loaded", () => {
    // Summary is loaded; the list hooks return empty (also loaded).
    const loaded = (data: unknown) =>
      ({ data, isPending: false }) as never;
    vi.mocked(useAccounts).mockReturnValue(loaded([]));
    vi.mocked(useSummary).mockReturnValue(loaded(loadedSummary()));
    vi.mocked(useTransactions).mockReturnValue(loaded([]));
    vi.mocked(useGoals).mockReturnValue(loaded([]));
    vi.mocked(useNetWorthSeries).mockReturnValue(loaded([]));
    renderOverview();

    expect(screen.getByText("£1,234.56")).toBeInTheDocument();
    expect(screen.queryAllByTestId("skeleton")).toHaveLength(0);
  });
});
