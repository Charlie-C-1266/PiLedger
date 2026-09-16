import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { AccountBalanceEntry } from "../types";

vi.mock("../api/client", () => ({ getAccountHistory: vi.fn() }));

import { getAccountHistory } from "../api/client";
import { useAccountHistory } from "./useAccountHistory";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useAccountHistory", () => {
  beforeEach(() => vi.mocked(getAccountHistory).mockReset());

  it("maps the selected range key to its day count", async () => {
    vi.mocked(getAccountHistory).mockResolvedValue([]);
    const { result } = renderHook(() => useAccountHistory(1, "30D"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAccountHistory).toHaveBeenCalledWith(1, 30);
  });

  it("defaults to the 90-day window", async () => {
    vi.mocked(getAccountHistory).mockResolvedValue([]);
    const { result } = renderHook(() => useAccountHistory(1), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAccountHistory).toHaveBeenCalledWith(1, 90);
  });

  it("returns the fetched series and uses 365 days for 1Y", async () => {
    const series: AccountBalanceEntry[] = [
      { balance: 100, notes: null, recorded_at: "2026-01-01T00:00:00" },
    ];
    vi.mocked(getAccountHistory).mockResolvedValue(series);
    const { result } = renderHook(() => useAccountHistory(1, "1Y"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(series);
    expect(getAccountHistory).toHaveBeenCalledWith(1, 365);
  });

  it("keys the query by account id, so switching accounts refetches", async () => {
    vi.mocked(getAccountHistory).mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useAccountHistory(id),
      { wrapper: makeWrapper(), initialProps: { id: 1 } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ id: 2 });
    await waitFor(() => expect(getAccountHistory).toHaveBeenCalledWith(2, 90));
  });
});
