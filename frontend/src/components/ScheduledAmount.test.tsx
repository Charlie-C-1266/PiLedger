import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScheduledAmount, { AutoBadge, ClosedAccountWarning, TransferMark } from "./ScheduledAmount";

// The styles live in ScheduledAmount.module.css beside the component (not in
// the Scheduled screen's stylesheet), so these pin the classes it applies.

describe("ScheduledAmount", () => {
  it("signs income and adds the up colour beside the caller's class", () => {
    render(<ScheduledAmount kind="income" amount={2500} currency="GBP" className="callerAmount" />);
    const el = screen.getByText("+£2,500.00");
    expect(el.className).toMatch(/callerAmount/);
    expect(el.className).toMatch(/amountUp/);
  });

  it("signs a payment as money out, in the caller's colour", () => {
    render(<ScheduledAmount kind="expense" amount={9.99} currency="GBP" className="callerAmount" />);
    const el = screen.getByText("−£9.99");
    expect(el.className).toBe("callerAmount");
  });

  it("leaves a transfer unsigned", () => {
    render(<ScheduledAmount kind="transfer" amount={100} currency="GBP" />);
    expect(screen.getByText("£100.00").className).not.toMatch(/amountUp/);
  });
});

describe("ScheduledAmount markers", () => {
  it("marks a transfer with a labelled icon", () => {
    render(<TransferMark />);
    expect(screen.getByRole("img", { name: "Transfer" }).className).toMatch(/kindIcon/);
  });

  it("badges an automatic item", () => {
    render(<AutoBadge />);
    const badge = screen.getByText("Auto");
    expect(badge).toHaveAttribute("title", "Posts automatically");
    expect(badge.className).toMatch(/autoBadge/);
  });

  it("warns when an automatic item's account is closed", () => {
    render(<ClosedAccountWarning name="Monzo" />);
    expect(screen.getByText("Won't post: Monzo is closed").className).toMatch(/closedWarn/);
  });
});
