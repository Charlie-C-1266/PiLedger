import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Budget as BudgetData } from "../types";

// Mock the data hook so we can drive the screen with a controlled budget.
vi.mock("../hooks/useBudget", () => ({ useBudget: vi.fn() }));

import Budget from "./Budget";
import { useBudget } from "../hooks/useBudget";

function makeBudget(over: Partial<BudgetData> = {}): BudgetData {
  return {
    incomes: [],
    groups: [],
    history: [],
    base_currency: "GBP",
    missing_rates: [],
    ...over,
  };
}

function renderBudget() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Budget />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("Budget guide link", () => {
  it("links the header guide button to the budgeting docs in a new tab", () => {
    vi.mocked(useBudget).mockReturnValue({
      data: makeBudget(),
      isLoading: false,
    } as ReturnType<typeof useBudget>);

    renderBudget();

    const link = screen.getByRole("link", { name: /new to budgeting/i });
    expect(link).toHaveAttribute("href", "/guide#budgeting");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
