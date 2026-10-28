import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({ recordBalance: vi.fn() }));

import UpdateBalanceModal from "./UpdateBalanceModal";
import { ToastProvider } from "./toast/ToastProvider";
import { recordBalance } from "../api/client";
import type { Account } from "../types";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const ACCOUNT: Account = {
  id: 12,
  user_id: 1,
  name: "Household",
  type: "current",
  subtype: "joint",
  institution: null,
  institution_name: null,
  currency: "GBP",
  interest_rate: 0,
  color: "#0d9488",
  counts_to_net_worth: true,
  closed: false,
  created_at: "2025-03-04 09:00:00",
  current_balance: 3482.17,
  last_updated: "2026-10-26T09:14:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordBalance).mockResolvedValue({ ok: true });
  // A fixed "today" so the date field's default and limit are predictable.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 15, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UpdateBalanceModal", () => {
  it("shows the account and its current balance", () => {
    render(<UpdateBalanceModal account={ACCOUNT} onClose={() => {}} />, { wrapper });
    expect(screen.getByRole("heading", { name: "Update balance" })).toBeInTheDocument();
    expect(screen.getByText(/Household — currently £3,482.17/)).toBeInTheDocument();
  });

  it("records today's balance now, with no backdated timestamp", async () => {
    const onClose = vi.fn();
    render(<UpdateBalanceModal account={ACCOUNT} onClose={onClose} />, { wrapper });

    await userEvent.type(screen.getByLabelText("New balance"), "3600.50");
    await userEvent.click(screen.getByRole("button", { name: "Update balance" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(recordBalance).toHaveBeenCalledWith(12, 3600.5, {
      recorded_at: undefined,
      notes: undefined,
    });
  });

  it("backdates to midday UTC on an earlier date and sends the note", async () => {
    const onClose = vi.fn();
    render(<UpdateBalanceModal account={ACCOUNT} onClose={onClose} />, { wrapper });

    await userEvent.type(screen.getByLabelText("New balance"), "3100");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-01" } });
    await userEvent.type(screen.getByLabelText("Note"), "  October statement ");
    await userEvent.click(screen.getByRole("button", { name: "Update balance" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(recordBalance).toHaveBeenCalledWith(12, 3100, {
      recorded_at: "2026-10-01T12:00:00Z",
      notes: "October statement",
    });
  });

  it("won't save without a balance", () => {
    render(<UpdateBalanceModal account={ACCOUNT} onClose={() => {}} />, { wrapper });
    expect(screen.getByRole("button", { name: "Update balance" })).toBeDisabled();
  });

  it("won't save a date in the future", async () => {
    render(<UpdateBalanceModal account={ACCOUNT} onClose={() => {}} />, { wrapper });

    await userEvent.type(screen.getByLabelText("New balance"), "100");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-02" } });

    expect(screen.getByText("The date can't be in the future.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update balance" })).toBeDisabled();
    expect(screen.getByLabelText("Date")).toHaveAttribute("max", "2026-10-26");
  });

  it("keeps the dialog open with a message when saving fails", async () => {
    vi.mocked(recordBalance).mockRejectedValue(new Error("500"));
    const onClose = vi.fn();
    render(<UpdateBalanceModal account={ACCOUNT} onClose={onClose} />, { wrapper });

    await userEvent.type(screen.getByLabelText("New balance"), "100");
    await userEvent.click(screen.getByRole("button", { name: "Update balance" }));

    expect(
      await screen.findByText("Couldn't update the balance. Please try again."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("UpdateBalanceModal refreshes", () => {
  it("refreshes the transaction lists, where the Balance adjustment appears", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockReturnValue(Promise.resolve());
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <UpdateBalanceModal account={ACCOUNT} onClose={onClose} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByLabelText("New balance"), "3500");
    await userEvent.click(screen.getByRole("button", { name: "Update balance" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["transactions", "accounts"]));
  });
});
