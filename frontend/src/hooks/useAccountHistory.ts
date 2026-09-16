import { useQuery } from "@tanstack/react-query";
import { getAccountHistory } from "../api/client";
import { RANGE_TO_DAYS } from "./useAllHistory";
import type { RangeKey } from "../types";

/** Balance history for a single account, over the selected range. Mirrors
 * `useAllHistory`'s range→days mapping so both charts share the same window
 * for a given `RangePills` selection. */
export function useAccountHistory(accountId: number, range: RangeKey = "90D") {
  const days = RANGE_TO_DAYS[range];
  return useQuery({
    queryKey: ["account-history", accountId, days],
    queryFn: () => getAccountHistory(accountId, days),
  });
}
