import { useQuery } from "@tanstack/react-query";
import { getAccountActivity } from "../api/client";

/** One account's change and transaction count over the last `days`, for the
 * account page's delta pill and "Last 30 days · N transactions" line. Keyed
 * under "account-activity" so balance and transaction changes refresh it. */
export function useAccountActivity(accountId: number, days = 30) {
  return useQuery({
    queryKey: ["account-activity", accountId, days],
    queryFn: () => getAccountActivity(accountId, days),
    enabled: Number.isInteger(accountId) && accountId > 0,
  });
}
