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
});
