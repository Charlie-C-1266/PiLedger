import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "../../theme/ThemeProvider";
import type { AccountHistory } from "../../types";

// Recharts needs real layout (ResizeObserver) that jsdom lacks, so swap it for
// inert stubs — we only assert that one <Line> is emitted per account here, and
// cover the data shaping through buildHistoryRows directly below.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="linechart">{children}</div>
  ),
  Line: ({ name }: { name: string }) => <div data-testid="line">{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

import AccountHistoryChart from "./AccountHistoryChart";
import { buildHistoryRows } from "./accountHistory";

const accounts: AccountHistory[] = [
  {
    id: 1,
    name: "Savings",
    color: "#111111",
    type: "savings",
    currency: "GBP",
    history: [
      { balance: 100, date: "2026-01-01T00:00:00" },
      { balance: 120, date: "2026-01-05T00:00:00" },
    ],
  },
  {
    id: 2,
    name: "Dollars",
    color: "#222222",
    type: "current",
    currency: "USD",
    history: [{ balance: 50, date: "2026-01-03T00:00:00" }],
  },
];

describe("buildHistoryRows", () => {
  it("unions dates, keys series by account, and carries balances forward", () => {
    const { rows, series } = buildHistoryRows(accounts);

    expect(series.map((s) => s.key)).toEqual(["acc1", "acc2"]);
    expect(series[1]).toMatchObject({ name: "Dollars", currency: "USD" });

    // Three distinct dates across both accounts, oldest first.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-01-01T00:00:00",
      "2026-01-03T00:00:00",
      "2026-01-05T00:00:00",
    ]);

    // acc2 has no reading on the first date — left as a gap, not zero.
    expect("acc2" in rows[0]).toBe(false);
    // acc1 holds its 100 until its next reading on the 5th.
    expect(rows[1].acc1).toBe(100);
    // acc2's 50 carries forward to the last date.
    expect(rows[2].acc2).toBe(50);
  });

  it("drops accounts with no points and handles an empty input", () => {
    const withEmpty: AccountHistory[] = [
      accounts[0],
      { id: 9, name: "Empty", color: "#999", type: "current", currency: "GBP", history: [] },
    ];
    expect(buildHistoryRows(withEmpty).series.map((s) => s.key)).toEqual(["acc1"]);
    expect(buildHistoryRows([])).toEqual({ rows: [], series: [] });
  });
});

function renderChart(accs: AccountHistory[]) {
  return render(
    <ThemeProvider>
      <AccountHistoryChart accounts={accs} currency="GBP" />
    </ThemeProvider>
  );
}

describe("AccountHistoryChart", () => {
  it("draws one line per account and lists them in an accessible legend", () => {
    renderChart(accounts);

    expect(screen.getAllByTestId("line")).toHaveLength(2);
    const legend = screen.getByRole("list", { name: "Accounts in this chart" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(2);
    expect(within(legend).getByText("Savings")).toBeInTheDocument();
    expect(within(legend).getByText("Dollars")).toBeInTheDocument();
  });

  it("shows a friendly empty state when there is no history to plot", () => {
    renderChart([]);
    expect(screen.queryByTestId("linechart")).not.toBeInTheDocument();
    expect(screen.getByText(/not enough balance history/i)).toBeInTheDocument();
  });
});
