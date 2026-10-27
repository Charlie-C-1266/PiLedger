import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({
  updateAccount: vi.fn(),
  removeAccount: vi.fn(),
  recordBalance: vi.fn(),
}));

// Mocked only to prove the modal no longer fetches history (D13: the chart
// moved to the account page).
vi.mock("../hooks/useAccountHistory", () => ({ useAccountHistory: vi.fn() }));

import EditAccountModal from "./EditAccountModal";
import { updateAccount, recordBalance, removeAccount } from "../api/client";
import { useAccountHistory } from "../hooks/useAccountHistory";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { Account } from "../types";

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

  it("no longer shows or fetches balance history", () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });

    expect(screen.queryByText("History")).not.toBeInTheDocument();
    expect(screen.queryByText(/balance history/i)).not.toBeInTheDocument();
    expect(useAccountHistory).not.toHaveBeenCalled();
  });

  it("calls onDeleted rather than onClose once the account is deleted", async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <EditAccountModal account={makeAccount()} onClose={onClose} onDeleted={onDeleted} />,
      { wrapper },
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(removeAccount).toHaveBeenCalledWith(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("EditAccountModal low-balance warning", () => {
  const field = () => screen.getByLabelText("Warn me below");
  const save = () => userEvent.click(screen.getByRole("button", { name: "Update account" }));

  it("offers an empty Warn me below field with a hint on an asset account", () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    expect(field()).toHaveValue("");
    expect(field()).toHaveAccessibleDescription(
      "Show a warning when this account is projected to fall below this amount. Leave empty to warn only below £0.",
    );
  });

  it("prefills the stored amount", () => {
    render(
      <EditAccountModal account={makeAccount({ low_balance_threshold: 200 })} onClose={() => {}} />,
      { wrapper },
    );
    expect(field()).toHaveValue("200");
  });

  it("saves a new amount", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    await userEvent.type(field(), "1,250.50");
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { low_balance_threshold: 1250.5 });
  });

  it("stores null when the field is cleared", async () => {
    render(
      <EditAccountModal account={makeAccount({ low_balance_threshold: 200 })} onClose={() => {}} />,
      { wrapper },
    );
    await userEvent.clear(field());
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { low_balance_threshold: null });
  });

  it("won't save a negative amount, and says why", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    await userEvent.type(field(), "-5");
    await save();
    expect(updateAccount).not.toHaveBeenCalled();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(
      "Enter an amount of zero or more, or leave it empty.",
    );
  });

  it("leaves the amount alone when it isn't changed", async () => {
    render(
      <EditAccountModal account={makeAccount({ low_balance_threshold: 200 })} onClose={() => {}} />,
      { wrapper },
    );
    await userEvent.type(screen.getByPlaceholderText(/New balance/), "500");
    await save();
    expect(recordBalance).toHaveBeenCalledWith(1, 500);
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it("isn't offered on a credit card or a loan", () => {
    const { unmount } = render(
      <EditAccountModal account={makeAccount({ type: "credit" })} onClose={() => {}} />,
      { wrapper },
    );
    expect(screen.queryByLabelText("Warn me below")).not.toBeInTheDocument();
    unmount();
    render(<EditAccountModal account={makeAccount({ type: "loan" })} onClose={() => {}} />, {
      wrapper,
    });
    expect(screen.queryByLabelText("Warn me below")).not.toBeInTheDocument();
  });
});
