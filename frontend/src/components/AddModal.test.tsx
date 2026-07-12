import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({
  getAccounts: vi.fn().mockResolvedValue([
    { id: 1, name: "Current", currency: "GBP", closed: false },
    { id: 2, name: "Old Barclays", currency: "GBP", closed: true },
  ]),
  getCategories: vi.fn().mockResolvedValue({ defaults: ["Groceries"], custom: [] }),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

import AddModal from "./AddModal";
import { ToastProvider } from "./toast/ToastProvider";
import { createTransaction } from "../api/client";
import type { Transaction } from "../types";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

const CLOSED_ACCT_TXN: Transaction = {
  id: 1,
  user_id: 1,
  account_id: 2,
  amount: -10,
  occurred_at: "2026-01-01T00:00:00Z",
  merchant: "Old shop",
  category: "",
  note: "",
  created_at: "2026-01-01T00:00:00Z",
};

describe("AddModal", () => {
  it("excludes closed accounts from the account select when adding", async () => {
    render(<AddModal accountId={null} onClose={() => {}} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Current" })).toBeInTheDocument()
    );
    expect(
      screen.queryByRole("option", { name: /Old Barclays/ })
    ).not.toBeInTheDocument();
  });

  it("still shows the transaction's own closed account when editing", async () => {
    render(
      <AddModal accountId={null} transaction={CLOSED_ACCT_TXN} onClose={() => {}} />,
      { wrapper }
    );
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: /Old Barclays \(closed\)/ })
      ).toBeInTheDocument()
    );
  });

  it("shows a confirmation toast after a transaction is recorded", async () => {
    vi.mocked(createTransaction).mockResolvedValue({} as Transaction);
    const onClose = vi.fn();
    render(<AddModal accountId={1} onClose={onClose} />, { wrapper });

    await userEvent.type(screen.getByPlaceholderText("Tesco, Spotify…"), "Tesco");
    await userEvent.type(
      screen.getByPlaceholderText("Amount (e.g. 42.50)"),
      "42.50"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save transaction" })
    );

    expect(await screen.findByText("Transaction recorded!")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error toast when recording fails, keeping the modal open", async () => {
    vi.mocked(createTransaction).mockRejectedValue(new Error("500 boom"));
    const onClose = vi.fn();
    render(<AddModal accountId={1} onClose={onClose} />, { wrapper });

    await userEvent.type(screen.getByPlaceholderText("Tesco, Spotify…"), "Tesco");
    await userEvent.type(
      screen.getByPlaceholderText("Amount (e.g. 42.50)"),
      "42.50"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save transaction" })
    );

    expect(
      await screen.findByText("Couldn't record transaction")
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
