import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { AccountHistory } from "../types";

vi.mock("../api/client", () => ({ getAllHistory: vi.fn() }));

import { getAllHistory } from "../api/client";
import { useAllHistory, RANGE_TO_DAYS } from "./useAllHistory";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useAllHistory", () => {
  beforeEach(() => vi.mocked(getAllHistory).mockReset());

  it("maps the selected range key to its day count", async () => {
    vi.mocked(getAllHistory).mockResolvedValue([]);
    const { result } = renderHook(() => useAllHistory("30D"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAllHistory).toHaveBeenCalledWith(30);
  });

  it("defaults to the 90-day window", async () => {
    vi.mocked(getAllHistory).mockResolvedValue([]);
    const { result } = renderHook(() => useAllHistory(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAllHistory).toHaveBeenCalledWith(90);
  });

  it("returns the fetched series and uses 365 days for 1Y", async () => {
    const series: AccountHistory[] = [
      {
        id: 1,
        name: "Savings",
        color: "#111",
        type: "savings",
        currency: "GBP",
        history: [{ balance: 100, date: "2026-01-01T00:00:00" }],
      },
    ];
    vi.mocked(getAllHistory).mockResolvedValue(series);
    const { result } = renderHook(() => useAllHistory("1Y"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(series);
    expect(getAllHistory).toHaveBeenCalledWith(365);
  });

  it("exposes the range→days map mirroring the backend", () => {
    expect(RANGE_TO_DAYS).toEqual({ "7D": 7, "30D": 30, "90D": 90, "1Y": 365 });
  });
});
