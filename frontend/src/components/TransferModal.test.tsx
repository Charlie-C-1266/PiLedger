import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({
  getAccounts: vi.fn().mockResolvedValue([
    { id: 1, name: "Current", currency: "GBP", closed: false },
    { id: 2, name: "Savings", currency: "GBP", closed: false },
    { id: 3, name: "Old Barclays", currency: "GBP", closed: true },
  ]),
  createTransfer: vi.fn(),
}));

import TransferModal from "./TransferModal";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TransferModal", () => {
  it("excludes closed accounts from both the from and to selects", async () => {
    render(<TransferModal onClose={() => {}} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Current/ })).toBeInTheDocument()
    );
    expect(
      screen.queryByRole("option", { name: /Old Barclays/ })
    ).not.toBeInTheDocument();
  });

  it("starts with no source account picked by default", async () => {
    render(<TransferModal onClose={() => {}} />, { wrapper });
    const [from, to] = await screen.findAllByRole("combobox");
    expect(from).toHaveValue("");
    expect(to).toBeDisabled();
  });

  it("starts from the given account, with its destinations ready to pick", async () => {
    render(<TransferModal fromAccountId={2} onClose={() => {}} />, { wrapper });
    const [from, to] = await screen.findAllByRole("combobox");
    expect(from).toHaveValue("2");
    expect(to).toBeEnabled();
    // The source can't also be the destination.
    const toOptions = [...(to as HTMLSelectElement).options].map((o) => o.textContent);
    expect(toOptions).toEqual(["To account", "Current"]);
  });
});
