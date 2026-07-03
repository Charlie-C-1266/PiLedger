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
});
