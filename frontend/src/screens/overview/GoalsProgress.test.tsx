import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Goal } from "../../types";

vi.mock("../../hooks/useGoals", () => ({ useGoals: vi.fn() }));
vi.mock("../../hooks/useSummary", () => ({ useSummary: vi.fn() }));

import GoalsProgress from "./GoalsProgress";
import { useGoals } from "../../hooks/useGoals";
import { useSummary } from "../../hooks/useSummary";

function makeGoal(over: Partial<Goal>): Goal {
  return {
    id: 1,
    user_id: 1,
    name: "Goal",
    target: 1000,
    saved: 0,
    monthly: 0,
    color: "#0F766E",
    created_at: "2024-01-01T00:00:00Z",
    ...over,
  };
}

function setGoals(goals: Goal[]) {
  vi.mocked(useGoals).mockReturnValue({ data: goals, isPending: false } as never);
  vi.mocked(useSummary).mockReturnValue({
    data: { base_currency: "GBP" },
    isPending: false,
  } as never);
}

describe("GoalsProgress", () => {
  it("shows the empty state when there are no goals", () => {
    setGoals([]);
    render(<GoalsProgress />);
    expect(screen.getByText("No goals yet")).toBeInTheDocument();
  });

  it("shows the percentage and months-left for a goal with a monthly contribution", () => {
    // 250 of 1000 = 25%; (1000−250)/250 = 3 months left.
    setGoals([makeGoal({ name: "Holiday", target: 1000, saved: 250, monthly: 250 })]);
    render(<GoalsProgress />);

    expect(screen.getByText("Holiday")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    // Footer text spans several text nodes; match leniently to stay robust to
    // the separator character and whitespace.
    expect(screen.getByText(/£250\.00 of £1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/3mo left/)).toBeInTheDocument();
  });

  it("omits months-left when there is no monthly contribution", () => {
    setGoals([makeGoal({ name: "Rainy day", target: 500, saved: 100, monthly: 0 })]);
    render(<GoalsProgress />);

    expect(screen.getByText(/£100\.00 of £500\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/mo left/)).not.toBeInTheDocument();
  });
});
