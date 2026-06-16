import { useMutation, useQuery } from "@tanstack/react-query";
import { getRates, updateRates } from "../api/client";
import { useInvalidate } from "./useInvalidate";

export function useRates() {
  return useQuery({ queryKey: ["rates"], queryFn: getRates });
}

/**
 * Replace the whole manual-rates table. Changing a rate re-converts every
 * foreign balance into the base currency, so on success this refreshes the
 * rates, summary, net-worth and (FX-converted) budget-spend caches — see
 * `useInvalidate().ratesChanged`.
 */
export function useUpdateRates() {
  const inv = useInvalidate();
  return useMutation({
    mutationKey: ["updateRates"],
    mutationFn: updateRates,
    onSuccess: () => inv.ratesChanged(),
  });
}
