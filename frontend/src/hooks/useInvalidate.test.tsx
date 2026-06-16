import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useInvalidate } from "./useInvalidate";

function setup() {
  const qc = new QueryClient();
  const spy = vi
    .spyOn(qc, "invalidateQueries")
    .mockReturnValue(Promise.resolve());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useInvalidate(), { wrapper });
  return { result, spy };
}

function bustedKeys(spy: ReturnType<typeof vi.spyOn>): Set<string> {
  return new Set(
    spy.mock.calls.map(
      (c: unknown[]) => (c[0] as { queryKey: string[] }).queryKey[0],
    ),
  );
}

describe("useInvalidate ripple sets", () => {
  it("accountChanged busts balances + every net-worth view (not transactions/budget)", () => {
    const { result, spy } = setup();
    result.current.accountChanged();
    expect(bustedKeys(spy)).toEqual(
      new Set(["accounts", "summary", "networth", "history-all", "projections"]),
    );
  });

  it("transactionChanged busts the full money-flow ripple, incl. networth + budget", () => {
    // The original bug this guards: a transaction must refresh the net-worth
    // trend and budget spend, not just the transaction list and balances.
    const { result, spy } = setup();
    result.current.transactionChanged();
    expect(bustedKeys(spy)).toEqual(
      new Set([
        "transactions",
        "accounts",
        "summary",
        "networth",
        "history-all",
        "projections",
        "budget",
      ]),
    );
  });

  it("ratesChanged busts rates, summary, networth and the FX-converted budget", () => {
    const { result, spy } = setup();
    result.current.ratesChanged();
    expect(bustedKeys(spy)).toEqual(
      new Set(["rates", "summary", "networth", "budget"]),
    );
  });

  it("scoped changes bust only their own cache", () => {
    const { result, spy } = setup();
    result.current.goalChanged();
    result.current.budgetChanged();
    result.current.categoryChanged();
    expect(bustedKeys(spy)).toEqual(new Set(["goals", "budget", "categories"]));
  });
});
