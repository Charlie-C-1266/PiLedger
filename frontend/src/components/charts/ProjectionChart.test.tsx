import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { PrivacyProvider, STORAGE_KEY } from "../../privacy/PrivacyProvider";
import { buildChartSeries } from "../../screens/account/projectionModel";
import {
  AS_OF,
  addDays,
  makeProjection,
  type EventSpec,
} from "../../test/projectionFixture";

// Recharts needs real layout (ResizeObserver) that jsdom lacks; it only draws
// the lines and axes here, so inert stubs keep the overlay under test.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="areachart">{children}</div>
  ),
  Area: ({ dataKey }: { dataKey: string }) => <div data-testid={`area-${dataKey}`} />,
  XAxis: () => null,
  YAxis: () => null,
}));

import ProjectionChart from "./ProjectionChart";

function renderChart({
  start = 1000,
  events = [] as EventSpec[],
  months = 3,
  showLow = true,
} = {}) {
  const p = makeProjection({ start, events });
  const horizon = p.horizons.find((h) => h.months === months)!;
  const series = buildChartSeries(
    p,
    [{ balance: 900, notes: null, recorded_at: `${addDays(AS_OF, -60)}T12:00:00Z` }],
    horizon,
  );
  const utils = render(
    <ThemeProvider>
      <PrivacyProvider>
        <ProjectionChart series={series} months={months} currency="GBP" showLow={showLow} />
      </PrivacyProvider>
    </ThemeProvider>,
  );
  return { ...utils, series };
}

const part = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-part="${name}"]`);

beforeEach(() => localStorage.removeItem(STORAGE_KEY));

describe("ProjectionChart", () => {
  it("draws the actual and projected lines with a Today marker", () => {
    const { container } = renderChart();
    expect(
      screen.getByRole("group", {
        name: "Balance chart, in 3 months. Use left and right arrow keys to read values.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("area-actual")).toBeInTheDocument();
    expect(screen.getByTestId("area-projected")).toBeInTheDocument();
    expect(part(container, "today")).toHaveTextContent("Today");
  });

  it("labels the end point and the low point", () => {
    const { container } = renderChart({
      start: 1000,
      events: [
        { date: addDays(AS_OF, 10), name: "Rent", amount: -600 },
        { date: addDays(AS_OF, 40), name: "Pay", amount: 900 },
      ],
    });
    expect(part(container, "end-label")).toHaveTextContent("£1,300.00");
    expect(part(container, "low-label")).toHaveTextContent("Low £400 · 5 Nov");
  });

  it("leaves the low point unlabelled for a debt", () => {
    const { container } = renderChart({
      events: [
        { date: addDays(AS_OF, 10), name: "Repay", amount: -600 },
        { date: addDays(AS_OF, 40), name: "Spend", amount: 900 },
      ],
      showLow: false,
    });
    expect(part(container, "low-label")).toBeNull();
  });

  it("draws a zero line only when the projection goes below zero", () => {
    const positive = renderChart();
    expect(part(positive.container, "zero-line")).toBeNull();
    positive.unmount();

    const { container } = renderChart({
      start: 100,
      events: [{ date: addDays(AS_OF, 10), name: "Rent", amount: -400 }],
    });
    expect(part(container, "zero-line")).toBeInTheDocument();
  });

  it("drops the end label and masks the low point in privacy mode", () => {
    localStorage.setItem(STORAGE_KEY, "hidden");
    const { container } = renderChart({
      events: [
        { date: addDays(AS_OF, 10), name: "Rent", amount: -600 },
        { date: addDays(AS_OF, 40), name: "Pay", amount: 900 },
      ],
    });
    expect(part(container, "end-label")).toBeNull();
    expect(part(container, "low-label")).toHaveTextContent("Low 5 Nov");
    expect(container.textContent).not.toMatch(/£\d/);
  });

  it("lists month-end balances in a visually hidden table", () => {
    renderChart({ events: [{ date: addDays(AS_OF, 10), name: "Pay", amount: 250 }] });
    const table = screen.getByRole("table", { name: "Projected month-end balances" });
    expect(table).toHaveClass("sr-only");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "31 Oct 2026£1,000.00",
      "30 Nov 2026£1,250.00",
      "31 Dec 2026£1,250.00",
      "26 Jan 2027£1,250.00",
    ]);
  });

  it("reads values with the arrow keys, starting from today", () => {
    renderChart({ events: [{ date: addDays(AS_OF, 1), name: "Pay", amount: 250 }] });
    const chart = screen.getByRole("group", { name: /Balance chart/ });
    chart.focus();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(chart).toHaveTextContent("Mon 26 Oct 2026");
    expect(chart).toHaveTextContent("£1,000.00 · today");
    fireEvent.keyDown(chart, { key: "End" });
    expect(chart).toHaveTextContent("Tue 26 Jan 2027");
    expect(chart).toHaveTextContent("£1,250.00 · projected");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(chart).toHaveTextContent("£900.00 · actual");
    fireEvent.blur(chart);
    expect(chart).not.toHaveTextContent("· actual");
  });
});
