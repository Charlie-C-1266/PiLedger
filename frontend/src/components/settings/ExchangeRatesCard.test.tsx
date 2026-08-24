import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExchangeRatesCard from "./ExchangeRatesCard";
import { ApiError, getRates, updateRates, getSummary, updatePrefs } from "../../api/client";
import type { Rates, Summary } from "../../types";

vi.mock("../../api/client", async (importOriginal) => {
  // ApiError is a real class the card branches on, so keep the original.
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ApiError: actual.ApiError,
    getRates: vi.fn(),
    updateRates: vi.fn(),
    getSummary: vi.fn(),
    getPrefs: vi.fn(),
    updatePrefs: vi.fn(),
  };
});

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

  it("offers the base currency as a select seeded from the saved rates", async () => {
    vi.mocked(getRates).mockResolvedValue({ base_currency: "USD", rates: [] });
    vi.mocked(getSummary).mockResolvedValue(summaryWithMissingUsd);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderCard(client);

    // The select renders immediately with the "GBP" fallback and only picks up
    // the saved base once the rates query settles, so wait for the value.
    const select = await screen.findByLabelText<HTMLSelectElement>("Base currency");
    await waitFor(() => expect(select.value).toBe("USD"));
  });

  it("switches the base currency and confirms it", async () => {
    vi.mocked(getRates).mockResolvedValue({ base_currency: "GBP", rates: [] });
    vi.mocked(getSummary).mockResolvedValue(summaryWithMissingUsd);
    vi.mocked(updatePrefs).mockResolvedValue({ base_currency: "EUR" });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderCard(client);

    const select = await screen.findByLabelText("Base currency");
    fireEvent.change(select, { target: { value: "EUR" } });

    await waitFor(() =>
      expect(updatePrefs).toHaveBeenCalledWith({ base_currency: "EUR" }),
    );
    expect(await screen.findByText("Base currency is now EUR")).toBeInTheDocument();
  });

  it("shows the server's reason verbatim when the switch is rejected", async () => {
    // The 400 names the rate to add first — a generic "failed" message would
    // leave the user with no way to work out what to do.
    vi.mocked(getRates).mockResolvedValue({ base_currency: "GBP", rates: [] });
    vi.mocked(getSummary).mockResolvedValue(summaryWithMissingUsd);
    vi.mocked(updatePrefs).mockRejectedValue(
      new ApiError(400, "Add an exchange rate for EUR before making it your base currency", "400"),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderCard(client);

    fireEvent.change(await screen.findByLabelText("Base currency"), {
      target: { value: "EUR" },
    });

    expect(
      await screen.findByText(
        "Add an exchange rate for EUR before making it your base currency",
      ),
    ).toBeInTheDocument();
  });
});
