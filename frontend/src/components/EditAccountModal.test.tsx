import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    // A real class the modal branches on, to show the API's reason.
    ApiError: actual.ApiError,
    updateAccount: vi.fn(),
    removeAccount: vi.fn(),
    recordBalance: vi.fn(),
  };
});

// Mocked only to prove the modal no longer fetches history (D13: the chart
// moved to the account page).
vi.mock("../hooks/useAccountHistory", () => ({ useAccountHistory: vi.fn() }));

import EditAccountModal from "./EditAccountModal";
import { ApiError, updateAccount, recordBalance, removeAccount } from "../api/client";
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

  it("preselects the account's current provider", () => {
    render(
      <EditAccountModal account={makeAccount({ institution: "chase" })} onClose={() => {}} />,
      { wrapper },
    );
    expect(screen.getByLabelText("Provider")).toHaveValue("chase");
  });

  it("saves a newly chosen provider as a pair", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "chase");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, {
      institution: "chase",
      institution_name: null,
    });
  });

  it("clears the provider when it is unset", async () => {
    render(
      <EditAccountModal account={makeAccount({ institution: "chase" })} onClose={() => {}} />,
      { wrapper },
    );
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, {
      institution: null,
      institution_name: null,
    });
  });

  it("asks for a name when Other is chosen, and sends it with the slug", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    expect(screen.queryByLabelText("Provider name")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Provider"), "other");
    await userEvent.type(screen.getByLabelText("Provider name"), "Kroo");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    expect(updateAccount).toHaveBeenCalledWith(1, {
      institution: "other",
      institution_name: "Kroo",
    });
  });

  it("will not save Other without a name, since the API would reject it", async () => {
    render(<EditAccountModal account={makeAccount()} onClose={() => {}} />, { wrapper });
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "other");
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
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "starling");
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

describe("EditAccountModal balance refresh", () => {
  function renderWithSpy() {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockReturnValue(Promise.resolve());
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <EditAccountModal account={makeAccount()} onClose={onClose} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const busted = () =>
      spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    return { onClose, busted };
  }

  it("refreshes the transaction lists when a new balance is saved", async () => {
    const { onClose, busted } = renderWithSpy();
    await userEvent.type(screen.getByPlaceholderText("New balance (e.g. 2500.00)"), "250");
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(recordBalance).toHaveBeenCalledWith(1, 250);
    expect(busted()).toContain("transactions");
  });

  it("leaves the transaction lists alone when only settings change", async () => {
    const { onClose, busted } = renderWithSpy();
    await userEvent.click(screen.getByRole("switch", { name: "Closed" }));
    await userEvent.click(screen.getByRole("button", { name: "Update account" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(busted()).toContain("accounts");
    expect(busted()).not.toContain("transactions");
  });
});

describe("EditAccountModal details", () => {
  const save = () => userEvent.click(screen.getByRole("button", { name: "Update account" }));
  const renderModal = (overrides: Partial<Account> = {}, onClose = vi.fn()) => {
    render(<EditAccountModal account={makeAccount(overrides)} onClose={onClose} />, {
      wrapper,
    });
    return onClose;
  };

  it("is titled Edit account and prefills every detail the page lists", () => {
    renderModal({ type: "savings", subtype: "cash_isa", interest_rate: 4.1, currency: "EUR" });
    expect(screen.getByRole("heading", { name: "Edit account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nickname")).toHaveValue("Monzo");
    expect(screen.getByLabelText("Account type")).toHaveValue("savings");
    expect(screen.getByLabelText("Subtype")).toHaveValue("cash_isa");
    expect(screen.getByLabelText("Interest rate")).toHaveValue("4.1");
    expect(screen.getByLabelText("Currency")).toHaveValue("EUR");
  });

  it("saves a new nickname", async () => {
    renderModal();
    await userEvent.clear(screen.getByLabelText("Nickname"));
    await userEvent.type(screen.getByLabelText("Nickname"), "  Joint account ");
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { name: "Joint account" });
  });

  it("won't save an empty nickname, and says why", async () => {
    const onClose = renderModal();
    await userEvent.clear(screen.getByLabelText("Nickname"));
    await save();
    expect(updateAccount).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Give the account a nickname.");
  });

  it("saves a new interest rate", async () => {
    renderModal({ interest_rate: 3 });
    const field = screen.getByLabelText("Interest rate");
    await userEvent.clear(field);
    await userEvent.type(field, "4.75%");
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { interest_rate: 4.75 });
  });

  it("clears the interest rate to none", async () => {
    renderModal({ interest_rate: 3 });
    await userEvent.clear(screen.getByLabelText("Interest rate"));
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { interest_rate: 0 });
  });

  it("won't save a rate that isn't a percentage, and says why", async () => {
    renderModal();
    const field = screen.getByLabelText("Interest rate");
    await userEvent.type(field, "abc");
    await save();
    expect(updateAccount).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Enter a rate from 0 to 1,000%, or leave it empty.");
  });

  it("only offers types on the same side: money held or money owed", () => {
    const options = () =>
      Array.from(
        (screen.getByLabelText("Account type") as HTMLSelectElement).options,
        (o) => o.value,
      );
    const { unmount } = render(
      <EditAccountModal account={makeAccount({ type: "current" })} onClose={() => {}} />,
      { wrapper },
    );
    expect(options()).toEqual(["current", "savings", "invest"]);
    unmount();
    render(<EditAccountModal account={makeAccount({ type: "credit" })} onClose={() => {}} />, {
      wrapper,
    });
    expect(options()).toEqual(["loan", "credit"]);
  });

  it("sends the type with a subtype that fits it", async () => {
    renderModal({ type: "savings", subtype: "cash_isa" });
    await userEvent.selectOptions(screen.getByLabelText("Account type"), "current");
    // A Cash ISA isn't a kind of current account, so the subtype resets.
    expect(screen.getByLabelText("Subtype")).toHaveValue("general");
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { type: "current", subtype: "general" });
  });

  it("saves a new subtype on its own", async () => {
    renderModal({ type: "savings" });
    await userEvent.selectOptions(screen.getByLabelText("Subtype"), "easy_access");
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { subtype: "easy_access" });
  });

  it("saves a new currency and says amounts aren't converted", async () => {
    renderModal();
    const field = screen.getByLabelText("Currency");
    expect(field).not.toHaveAccessibleDescription();
    await userEvent.selectOptions(field, "EUR");
    expect(field).toHaveAccessibleDescription(
      "Amounts aren't converted: the balance and transactions keep their numbers in EUR.",
    );
    await save();
    expect(updateAccount).toHaveBeenCalledWith(1, { currency: "EUR" });
  });

  it("sends every change in one request", async () => {
    renderModal();
    await userEvent.clear(screen.getByLabelText("Nickname"));
    await userEvent.type(screen.getByLabelText("Nickname"), "Bills");
    await userEvent.type(screen.getByLabelText("Interest rate"), "1.5");
    await userEvent.click(screen.getByRole("switch", { name: "Closed" }));
    await save();
    expect(updateAccount).toHaveBeenCalledTimes(1);
    expect(updateAccount).toHaveBeenCalledWith(1, {
      name: "Bills",
      interest_rate: 1.5,
      closed: true,
    });
  });

  it("just closes when nothing changed", async () => {
    const onClose = renderModal();
    await save();
    expect(updateAccount).not.toHaveBeenCalled();
    expect(recordBalance).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the API's reason when a change is refused, and records no balance", async () => {
    vi.mocked(updateAccount).mockRejectedValue(
      new ApiError(400, '"Savings pot" is a scheduled transfer with Pot (GBP).', "400"),
    );
    const onClose = renderModal();
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await userEvent.type(screen.getByLabelText("New balance"), "100");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      '"Savings pot" is a scheduled transfer with Pot (GBP).',
    );
    expect(recordBalance).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
