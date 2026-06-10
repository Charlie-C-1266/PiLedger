import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExchangeRatesCard from "./ExchangeRatesCard";
import { getRates, updateRates, getSummary } from "../../api/client";
import type { Rates, Summary } from "../../types";

vi.mock("../../api/client", () => ({
  getRates: vi.fn(),
  updateRates: vi.fn(),
  getSummary: vi.fn(),
}));

const summaryWithMissingUsd: Summary = {
  total: 0,
  total_current: 0,
  total_savings: 0,
  total_loans: 0,
  total_credit: 0,
  total_invest: 0,
  assets: 0,
  debts: 0,
  savings_rate: 0,
  set_aside: 0,
  total_net_worth: 0,
  account_count: 1,
  base_currency: "GBP",
  missing_rates: ["USD"],
};

function renderCard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ExchangeRatesCard />
    </QueryClientProvider>
  );
}

describe("ExchangeRatesCard", () => {
  it("shows the save confirmation and keeps the typed rate after a remount mid-save", async () => {
    const emptyRates: Rates = { base_currency: "GBP", rates: [] };
    const savedRates: Rates = {
      base_currency: "GBP",
      rates: [{ currency: "USD", rate: 0.79, updated_at: "2024-01-01T00:00:00Z" }],
    };
    vi.mocked(getRates).mockResolvedValue(emptyRates);
    vi.mocked(getSummary).mockResolvedValue(summaryWithMissingUsd);
    vi.mocked(updateRates).mockResolvedValue(savedRates);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = renderCard(client);

    const input = await screen.findByLabelText("Value of 1 USD in GBP");
    fireEvent.change(input, { target: { value: "0.79" } });
    expect(input).toHaveValue("0.79");

    fireEvent.click(screen.getByRole("button", { name: "Save rates" }));

    await waitFor(() => {
      expect(updateRates).toHaveBeenCalledWith(
        [{ currency: "USD", rate: 0.79 }],
        expect.anything()
      );
    });

    // Simulate the page remounting this card mid-save, e.g. due to the
    // route's exit-animation lifecycle. Both the in-progress edit and the
    // save confirmation should still be visible afterwards.
    await act(async () => {
      unmount();
    });
    renderCard(client);

    await waitFor(() => {
      expect(screen.getByText("Exchange rates saved")).toBeInTheDocument();
    });
    const newInput = await screen.findByLabelText("Value of 1 USD in GBP");
    expect(newInput).toHaveValue("0.79");
  });
});
