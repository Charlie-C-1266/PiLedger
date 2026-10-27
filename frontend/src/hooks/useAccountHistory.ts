import { useQuery } from "@tanstack/react-query";
import { getAccountHistory } from "../api/client";
import { RANGE_TO_DAYS } from "./useAllHistory";
import type { RangeKey } from "../types";

/** Balance history for a single account, over the selected range. Mirrors
 * `useAllHistory`'s range→days mapping so both charts share the same window
 * for a given `RangePills` selection. `opening` starts the series with the
 * balance the account had as the window opened (see `getAccountHistory`). */
export function useAccountHistory(
  accountId: number,
  range: RangeKey = "90D",
  opts: { opening?: boolean; enabled?: boolean } = {},
) {
  const days = RANGE_TO_DAYS[range];
  const opening = opts.opening ?? false;
  return useQuery({
    queryKey: opening
      ? ["account-history", accountId, days, "opening"]
      : ["account-history", accountId, days],
    queryFn: () =>
      opening
        ? getAccountHistory(accountId, days, { opening: true })
        : getAccountHistory(accountId, days),
    enabled: opts.enabled ?? true,
  });
}
