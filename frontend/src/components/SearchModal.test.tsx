import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../api/client", () => ({ getTransactions: vi.fn().mockResolvedValue([]) }));
vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
vi.mock("../hooks/useGoals", () => ({ useGoals: vi.fn() }));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));

import SearchModal from "./SearchModal";
import { useAccounts } from "../hooks/useAccounts";
import { useGoals } from "../hooks/useGoals";
import { useSummary } from "../hooks/useSummary";

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAccounts).mockReturnValue({
    data: [
      { id: 7, name: "Rainy day", type: "savings", currency: "GBP", current_balance: 8250 },
    ],
  } as never);
  vi.mocked(useGoals).mockReturnValue({ data: [] } as never);
  vi.mocked(useSummary).mockReturnValue({ data: { base_currency: "GBP" } } as never);
});

describe("SearchModal", () => {
  it("opens an account result on that account's own page", async () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/overview"]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <SearchModal onClose={onClose} />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByRole("textbox", { name: "Search query" }), "rainy");
    await userEvent.click(await screen.findByRole("button", { name: /Rainy day/ }));

    expect(screen.getByTestId("where")).toHaveTextContent("/accounts/7");
    expect(onClose).toHaveBeenCalled();
  });
});
