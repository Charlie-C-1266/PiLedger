import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("../api/client", () => ({ getAccountProjection: vi.fn() }));

import { getAccountProjection } from "../api/client";
import { useAccountProjection } from "./useAccountProjection";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  };
}

describe("useAccountProjection", () => {
  beforeEach(() => vi.mocked(getAccountProjection).mockReset());

  it("fetches one 12-month projection under the account-projection key", async () => {
    vi.mocked(getAccountProjection).mockResolvedValue({} as never);
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useAccountProjection(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAccountProjection).toHaveBeenCalledWith(7);
    expect(qc.getQueryData(["account-projection", 7])).toEqual({});
  });

  it("doesn't fetch for a closed account", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useAccountProjection(7, { enabled: false }), { wrapper });
    expect(getAccountProjection).not.toHaveBeenCalled();
  });
});
