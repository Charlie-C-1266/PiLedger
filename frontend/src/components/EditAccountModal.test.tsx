import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({
  updateAccount: vi.fn(),
  removeAccount: vi.fn(),
  recordBalance: vi.fn(),
}));

vi.mock("../hooks/useAccountHistory", () => ({ useAccountHistory: vi.fn() }));

// Recharts needs real layout (ResizeObserver) jsdom lacks; stub it so the
// history section renders without a chart library dependency.
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

import EditAccountModal from "./EditAccountModal";
import { updateAccount, recordBalance, removeAccount } from "../api/client";
import { useAccountHistory } from "../hooks/useAccountHistory";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Account, AccountBalanceEntry } from "../types";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    user_id: 1,
    name: "Monzo",
    type: "current",
    subtype: "general",
    institution: null,
    institution_name: null,
    currency: "GBP",
    interest_rate: 0,
    color: "#6366f1",
    counts_to_net_worth: true,
    closed: false,
    created_at: "2026-01-01T00:00:00Z",
    current_balance: 100,
    last_updated: null,
    ...overrides,
  };
}

function mockHistory(
  data: AccountBalanceEntry[] | undefined,
  overrides: Partial<ReturnType<typeof useAccountHistory>> = {},
) {
  vi.mocked(useAccountHistory).mockReturnValue({
    data,
    isPending: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof useAccountHistory>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateAccount).mockResolvedValue({} as Account);
  vi.mocked(recordBalance).mockResolvedValue({ ok: true });
  vi.mocked(removeAccount).mockResolvedValue({ ok: true });
  mockHistory([]);
});

describe("EditAccountModal", () => {
  it("renders a Closed toggle reflecting the account's current state", () => {
    render(<EditAccountModal account={makeAccount({ closed: true })} onClose={() => {}} />, {
      wrapper,
    });
    expect(screen.getByRole("switch", { name: "Closed" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("saves the closed flag when the toggle is flipped", async () => {
    render(<EditAccountModal account={makeAccount({ closed: false })} onClose={() => {}} />, {
      wrapper,
    });
    await userEvent.click(screen.getByRole("switch", { name: "Closed" }));
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, { closed: true });
  });

  it("preselects the account's current institution", () => {
    render(
      <EditAccountModal account={makeAccount({ institution: "chase" })} onClose={() => {}} />,
      { wrapper },
    );
    expect(screen.getByLabelText("Institution")).toHaveValue("chase");
  });

  it("saves a newly chosen institution as a pair", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "chase");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, {
      institution: "chase",
      institution_name: null,
    });
  });

  it("clears the provider when the institution is unset", async () => {
    render(
      <EditAccountModal account={makeAccount({ institution: "chase" })} onClose={() => {}} />,
      { wrapper },
    );
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, {
      institution: null,
      institution_name: null,
    });
  });

  it("asks for a name when Other is chosen, and sends it with the slug", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    expect(screen.queryByLabelText("Institution name")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Institution"), "other");
    await userEvent.type(screen.getByLabelText("Institution name"), "Kroo");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, {
      institution: "other",
      institution_name: "Kroo",
    });
  });

  it("will not save Other without a name, since the API would reject it", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "other");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).not.toHaveBeenCalled();
  });

  it("drops the stale custom name when switching from Other to a catalogue slug", async () => {
    render(
      <EditAccountModal
        account={makeAccount({ institution: "other", institution_name: "Kroo" })}
        onClose={() => {}}
      />,
      { wrapper },
    );
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "starling");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, {
      institution: "starling",
      institution_name: null,
    });
  });

  it("does not call updateAccount for closed when the toggle is untouched", async () => {
    render(<EditAccountModal account={makeAccount({ closed: false })} onClose={() => {}} />, {
      wrapper,
    });
    // Nudge a field that does trigger a save (balance) so handleSave proceeds.
    const balanceInput = screen.getByPlaceholderText(/New balance/);
    await userEvent.type(balanceInput, "500");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).not.toHaveBeenCalledWith(1, expect.objectContaining({ closed: expect.anything() }));
  });

  describe("balance history", () => {
    it("shows a loading state while history is fetched", () => {
      mockHistory(undefined, { isPending: true });
      render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });

      expect(screen.getByText(/loading balance history/i)).toBeInTheDocument();
    });

    it("shows an error state when history fails to load", () => {
      mockHistory(undefined, { isError: true });
      render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });

      expect(screen.getByText(/couldn't load balance history/i)).toBeInTheDocument();
    });

    it("shows an empty state with fewer than two history points", () => {
      mockHistory([{ balance: 100, notes: null, recorded_at: "2026-01-01T00:00:00" }]);
      render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });

      expect(screen.getByText(/not enough balance history/i)).toBeInTheDocument();
    });

    it("renders a chart line for the account with two or more history points", () => {
      mockHistory([
        { balance: 100, notes: null, recorded_at: "2026-01-01T00:00:00" },
        { balance: 150, notes: null, recorded_at: "2026-02-01T00:00:00" },
      ]);
      render(<EditAccountModal account={makeAccount({ name: "Monzo" })} onClose={() => {}} />, {
        wrapper,
      });

      expect(screen.getByTestId("line")).toHaveTextContent("Monzo");
    });
  });
});
