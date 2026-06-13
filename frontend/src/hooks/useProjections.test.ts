import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { AccountProjection } from "../types";

vi.mock("../api/client", () => ({ getProjections: vi.fn() }));

import { getProjections } from "../api/client";
import { useProjections } from "./useProjections";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

const sample: AccountProjection[] = [
  {
    id: 1,
    name: "Savings",
    color: "#111",
    currency: "GBP",
    initial_balance: 100,
    interest_rate: 5,
    "1yr": 105,
    "2yr": 110,
    "5yr": 128,
    points: [{ date: "2026-01-01", balance: 100 }],
  },
];

describe("useProjections", () => {
  beforeEach(() => vi.mocked(getProjections).mockReset());

  it("defaults to a 5-year (60-month) horizon", async () => {
    vi.mocked(getProjections).mockResolvedValue([]);
    const { result } = renderHook(() => useProjections(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getProjections).toHaveBeenCalledWith(60);
  });

  it("passes a custom horizon and returns the data", async () => {
    vi.mocked(getProjections).mockResolvedValue(sample);
    const { result } = renderHook(() => useProjections(24), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getProjections).toHaveBeenCalledWith(24);
    expect(result.current.data).toEqual(sample);
  });
});
