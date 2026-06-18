import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { SubscriptionOccurrence } from "../types";

vi.mock("../hooks/useSubscriptions", () => ({ useOccurrences: vi.fn() }));

import SubscriptionsCalendar from "./SubscriptionsCalendar";
import { useOccurrences } from "../hooks/useSubscriptions";

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

function renderCalendar() {
  return render(
    <ThemeProvider>
      <SubscriptionsCalendar currency="GBP" />
    </ThemeProvider>
  );
}

describe("SubscriptionsCalendar", () => {
  it("renders a payment badge on a day that has an occurrence", () => {
    const today = isoKey(new Date());
    setOccurrences([
      { date: today, subscription_id: 1, name: "Netflix", amount: 9.99, color: "#5546F6" },
    ]);
    renderCalendar();
    // The day cell exposes the occurrence count in its accessible name.
    expect(
      screen.getByRole("gridcell", { name: /1 payment/i })
    ).toBeInTheDocument();
  });

  it("opens a popover listing the day's payments when a dotted day is clicked", async () => {
    const today = isoKey(new Date());
    setOccurrences([
      { date: today, subscription_id: 1, name: "Netflix", amount: 9.99, color: "#5546F6" },
    ]);
    renderCalendar();
    await userEvent.click(screen.getByRole("gridcell", { name: /1 payment/i }));
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("£9.99")).toBeInTheDocument();
  });

  it("changes the displayed month when navigating forward", async () => {
    setOccurrences([]);
    renderCalendar();
    const grid = screen.getByRole("grid");
    const before = grid.getAttribute("aria-label");
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("grid").getAttribute("aria-label")).not.toBe(before);
  });
});
