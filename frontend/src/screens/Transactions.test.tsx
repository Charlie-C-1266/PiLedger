import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";

vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));
vi.mock("../hooks/useTransactions", () => ({ useTransactions: vi.fn() }));
vi.mock("../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
// The add/edit dialog has its own tests; it needs toasts and categories.
vi.mock("../components/AddModal", () => ({ default: () => null }));

import Transactions from "./Transactions";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { useTransactions } from "../hooks/useTransactions";

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider>
        <Transactions />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const accountSelect = () =>
  screen.getByRole("option", { name: "All accounts" }).closest("select") as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAccounts).mockReturnValue({
    data: [
      { id: 4, name: "Household", currency: "GBP", closed: false },
      { id: 7, name: "Rainy day", currency: "GBP", closed: false },
    ],
  } as never);
  vi.mocked(useSummary).mockReturnValue({ data: { base_currency: "GBP" } } as never);
  vi.mocked(useTransactions).mockReturnValue({ data: [] } as never);
});

describe("Transactions deep links", () => {
  it("filters to the account named in ?account=", () => {
    renderAt("/transactions?account=4");

    expect(accountSelect()).toHaveValue("4");
    expect(useTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ account: 4 }),
    );
  });

  it("shows every account without the param", () => {
    renderAt("/transactions");

    expect(accountSelect()).toHaveValue("");
    expect(useTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ account: undefined }),
    );
  });

  it("ignores an ?account= that isn't an id", () => {
    renderAt("/transactions?account=abc");

    expect(accountSelect()).toHaveValue("");
    expect(useTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ account: undefined }),
    );
  });

  it("still seeds the search box from ?q= alongside it", () => {
    renderAt("/transactions?q=tesco&account=7");

    expect(screen.getByPlaceholderText("Search…")).toHaveValue("tesco");
    expect(useTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "tesco", account: 7 }),
    );
  });
});

describe("Transactions totals", () => {
  const stat = (label: string) => screen.getByText(label).nextElementSibling;

  it("lists Balance adjustments but leaves them out of the money totals", () => {
    const base = {
      user_id: 1,
      account_id: 4,
      occurred_at: "2026-10-20T10:00:00Z",
      category: "",
      note: "",
      created_at: "2026-10-20T10:00:00Z",
    };
    vi.mocked(useTransactions).mockReturnValue({
      data: [
        { ...base, id: 1, amount: -20, merchant: "Tesco" },
        { ...base, id: 2, amount: 100, merchant: "Salary" },
        { ...base, id: 3, amount: 12.4, merchant: "Balance adjustment", adjustment: true },
        { ...base, id: 4, amount: -5, merchant: "Balance adjustment", adjustment: true },
      ],
    } as never);

    renderAt("/transactions");

    expect(stat("Showing")).toHaveTextContent("4");
    expect(stat("Inflow")).toHaveTextContent("£100.00");
    expect(stat("Outflow")).toHaveTextContent("£20.00");
    expect(stat("Net")).toHaveTextContent("£80.00");
    expect(screen.getAllByText("Balance adjustment")).toHaveLength(2);
  });
});
