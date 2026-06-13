import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ThemeProvider } from "../../theme/ThemeProvider";
import type { AccountProjection } from "../../types";

vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../../hooks/useProjections", () => ({ useProjections: vi.fn() }));

// Recharts needs real layout (ResizeObserver) jsdom lacks; stub it so we can
// count one <Line> per shown account. The row shaping is covered separately.
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

import { useProjections } from "../../hooks/useProjections";
import AccountProjectionsModal from "./AccountProjectionsModal";
import { buildProjectionRows } from "./accountProjections";

const projA: AccountProjection = {
  id: 1,
  name: "Savings",
  color: "#111111",
  currency: "GBP",
  initial_balance: 100,
  interest_rate: 5,
  "1yr": 105,
  "2yr": 110,
  "5yr": 128,
  points: [
    { date: "2026-01-01", balance: 100 },
    { date: "2026-02-01", balance: 101 },
  ],
};

const projB: AccountProjection = {
  id: 2,
  name: "Cash ISA",
  color: "#222222",
  currency: "GBP",
  initial_balance: 200,
  interest_rate: 3,
  "1yr": 206,
  "2yr": 212,
  "5yr": 999,
  points: [
    { date: "2026-01-01", balance: 200 },
    { date: "2026-02-01", balance: 201 },
  ],
};

describe("buildProjectionRows", () => {
  it("keys series by account and builds one row per aligned month index", () => {
    const { rows, series } = buildProjectionRows([projA, projB]);

    expect(series.map((s) => s.key)).toEqual(["acc1", "acc2"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ month: 0, date: "2026-01-01", acc1: 100, acc2: 200 });
    expect(rows[1]).toMatchObject({ month: 1, date: "2026-02-01", acc1: 101, acc2: 201 });
  });

  it("tolerates differing point lengths and an empty input", () => {
    const short: AccountProjection = { ...projB, id: 3, points: [{ date: "2026-01-01", balance: 200 }] };
    const { rows } = buildProjectionRows([projA, short]);
    expect(rows).toHaveLength(2);
    expect("acc3" in rows[1]).toBe(false); // no second point for the short series
    expect(buildProjectionRows([])).toEqual({ rows: [], series: [] });
  });
});

function renderModal() {
  return render(
    <ThemeProvider>
      <AccountProjectionsModal currency="GBP" onClose={() => {}} />
    </ThemeProvider>
  );
}

describe("AccountProjectionsModal", () => {
  beforeEach(() => vi.mocked(useProjections).mockReset());

  function mockProjections(data: AccountProjection[] | undefined, isPending = false) {
    vi.mocked(useProjections).mockReturnValue({
      data,
      isPending,
    } as ReturnType<typeof useProjections>);
  }

  it("shows a loading state while projections are fetched", () => {
    mockProjections(undefined, true);
    renderModal();
    expect(screen.getByText(/loading projections/i)).toBeInTheDocument();
  });

  it("prompts to add a savings account when there are none", () => {
    mockProjections([]);
    renderModal();
    expect(screen.getByText(/add a savings account with an interest rate/i)).toBeInTheDocument();
  });

  it("renders a milestone card and a line per account", () => {
    mockProjections([projA, projB]);
    renderModal();

    expect(screen.getAllByTestId("line")).toHaveLength(2);
    // 1/2/5-year milestones in each card, in the account's own currency.
    expect(screen.getByText("£128.00")).toBeInTheDocument(); // Savings 5yr
    expect(screen.getByText("£999.00")).toBeInTheDocument(); // Cash ISA 5yr
    expect(screen.getAllByText("5 yr").length).toBe(2);
  });

  it("toggling a chip off removes that account's line and card", async () => {
    mockProjections([projA, projB]);
    const user = userEvent.setup();
    renderModal();

    expect(screen.getAllByTestId("line")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /Cash ISA/ }));

    expect(screen.getAllByTestId("line")).toHaveLength(1);
    // The ISA milestone value is gone; the Savings one stays.
    expect(screen.queryByText("£999.00")).not.toBeInTheDocument();
    expect(screen.getByText("£128.00")).toBeInTheDocument();
  });
});
