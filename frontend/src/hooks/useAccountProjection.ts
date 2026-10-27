import { useQuery } from "@tanstack/react-query";
import { getAccountProjection } from "../api/client";

/** One account's 12-month projected balance for the account page. A single
 * request serves every horizon tile; the chart slices it. Keyed under
 * "account-projection" so balance, transaction and schedule changes refresh it.
 * Pass `enabled: false` for a closed account, which doesn't project. */
export function useAccountProjection(accountId: number, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["account-projection", accountId],
    queryFn: () => getAccountProjection(accountId),
    enabled: (opts.enabled ?? true) && Number.isInteger(accountId) && accountId > 0,
  });
}
