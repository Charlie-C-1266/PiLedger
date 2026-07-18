import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Single source of truth for "what a change touches" — the React Query caches
 * that must be refetched after each kind of mutation.
 *
 * Before this existed, every mutating modal hand-rolled its own
 * `invalidateQueries` list, and those lists had drifted: adding a transaction
 * never refreshed the net-worth trend, nothing refreshed the per-account
 * history chart or savings projections, and a rate change left the budget's
 * (FX-converted) spend stale. Centralising the ripple sets here keeps them in
 * lock-step — `useInvalidate.test.ts` pins each one.
 *
 * Keys rely on TanStack Query's prefix matching: invalidating `["networth"]`
 * also invalidates `["networth", "30D"]`, `["transactions", filters]`, etc.
 */
export function useInvalidate() {
  const qc = useQueryClient();
  return useMemo(() => {
    const bust = (...keys: string[]) =>
      keys.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));

    return {
      /** An account was created/edited or a balance was recorded: balances and
       *  every net-worth view derived from them change (but not transactions). */
      accountChanged: () =>
        bust("accounts", "summary", "networth", "history-all", "projections"),

      /** A transaction was created/edited/deleted, or a transfer was made — and
       *  also an account *deletion*, which cascades its transactions. Adjusts a
       *  balance (so the whole net-worth picture moves) and may change budget
       *  spend. The widest money-flow ripple. */
      transactionChanged: () =>
        bust(
          "transactions",
          "accounts",
          "summary",
          "networth",
          "history-all",
          "projections",
          "budget",
        ),

      /** A goal was created/edited/deleted. */
      goalChanged: () => bust("goals"),

      /** A subscription was created/edited/deleted: the list and any expanded
       *  calendar occurrences both go stale. */
      subscriptionChanged: () => bust("subscriptions", "occurrences"),

      /** A budget income/group/envelope changed (structure or allocation). */
      budgetChanged: () => bust("budget"),

      /** A custom transaction category was added or removed. */
      categoryChanged: () => bust("categories"),

      /** A personal access token was minted or revoked. */
      tokenChanged: () => bust("tokens"),

      /** An FX rate changed: re-converts every foreign balance into the base
       *  currency, so summary, net-worth trend and (converted) budget spend move. */
      ratesChanged: () => bust("rates", "summary", "networth", "budget"),
    };
  }, [qc]);
}
