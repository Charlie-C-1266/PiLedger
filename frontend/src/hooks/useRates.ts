import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRates, updateRates } from "../api/client";

export function useRates() {
  return useQuery({ queryKey: ["rates"], queryFn: getRates });
}

/**
 * Replace the whole manual-rates table. On success we invalidate the summary
 * and net-worth caches as well as the rates cache, because changing a rate
 * re-converts every foreign balance into the base currency.
 */
export function useUpdateRates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["updateRates"],
    mutationFn: updateRates,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rates"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["networth"] });
    },
  });
}
