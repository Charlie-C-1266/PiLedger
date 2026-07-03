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

import EditAccountModal from "./EditAccountModal";
import { updateAccount, recordBalance, removeAccount } from "../api/client";
import type { Account } from "../types";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    user_id: 1,
    name: "Monzo",
    type: "current",
    subtype: "general",
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateAccount).mockResolvedValue({} as Account);
  vi.mocked(recordBalance).mockResolvedValue({ ok: true });
  vi.mocked(removeAccount).mockResolvedValue({ ok: true });
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
});
