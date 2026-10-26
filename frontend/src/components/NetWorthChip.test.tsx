import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NetWorthChip from "./NetWorthChip";

describe("NetWorthChip", () => {
  it("says a counted account counts toward net worth", () => {
    render(<NetWorthChip countsToNetWorth closed={false} />);
    expect(screen.getByText("Counts toward net worth")).toBeInTheDocument();
    expect(screen.queryByText("Set aside")).not.toBeInTheDocument();
  });

  it("calls an excluded account Set aside, as the tile badge does", () => {
    render(<NetWorthChip countsToNetWorth={false} closed={false} />);
    expect(screen.getByText("Set aside")).toBeInTheDocument();
    expect(screen.queryByText("Counts toward net worth")).not.toBeInTheDocument();
  });

  it("shows Closed in place of either state", () => {
    const { rerender } = render(<NetWorthChip countsToNetWorth closed />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByText("Counts toward net worth")).not.toBeInTheDocument();

    rerender(<NetWorthChip countsToNetWorth={false} closed />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByText("Set aside")).not.toBeInTheDocument();
  });

  it("keeps its icon out of the accessibility tree", () => {
    const { container } = render(<NetWorthChip countsToNetWorth closed={false} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
