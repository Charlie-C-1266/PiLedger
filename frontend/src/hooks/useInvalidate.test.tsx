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
  it("accountChanged busts balances, the account page's activity, history and projection + every net-worth view (not transactions/budget)", () => {
    const { result, spy } = setup();
    result.current.accountChanged();
    expect(bustedKeys(spy)).toEqual(
      new Set([
        "accounts",
        "account-activity",
        "account-history",
        "account-projection",
        "summary",
        "networth",
        "history-all",
        "projections",
      ]),
    );
  });

  it("balanceRecorded adds the transaction lists to the account ripple (a Balance adjustment), but not budget spend", () => {
    const { result, spy } = setup();
    result.current.balanceRecorded();
    expect(bustedKeys(spy)).toEqual(
      new Set([
        "accounts",
        "account-activity",
        "account-history",
        "account-projection",
        "summary",
        "networth",
        "history-all",
        "projections",
        "transactions",
      ]),
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
        "account-activity",
        "account-history",
        "account-projection",
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
    result.current.tokenChanged();
    expect(bustedKeys(spy)).toEqual(
      new Set(["goals", "budget", "categories", "tokens"]),
    );
  });

  it("subscriptionChanged busts the list, the calendar and the whole transaction ripple", () => {
    // Scheduled items now create transactions (auto-post, Post now) and tag
    // them, so a change to one must refresh balances, transaction lists and
    // the account projections built from schedules — whatever
    // transactionChanged covers, now or later.
    const { result, spy } = setup();
    result.current.transactionChanged();
    const transactionKeys = bustedKeys(spy);
    spy.mockClear();

    result.current.subscriptionChanged();
    const keys = bustedKeys(spy);
    expect(keys).toEqual(
      new Set(["subscriptions", "occurrences", ...transactionKeys]),
    );
    for (const key of [
      "transactions",
      "accounts",
      "account-activity",
      "account-projection",
      "summary",
      "history-all",
    ]) {
      expect(keys).toContain(key);
    }
  });
  it("baseCurrencyChanged busts every figure denominated in the base currency", () => {
    // Switching base re-scales the stored rates server-side and re-denominates
    // every total, so leaving any of these cached shows figures in the old
    // currency until a reload.
    const { result, spy } = setup();
    result.current.baseCurrencyChanged();
    expect(bustedKeys(spy)).toEqual(
      new Set([
        "prefs",
        "rates",
        "summary",
        "networth",
        "budget",
        "history-all",
        "projections",
      ]),
    );
  });
});
