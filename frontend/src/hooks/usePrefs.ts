import { useMutation, useQuery } from "@tanstack/react-query";
import { getPrefs, updatePrefs } from "../api/client";
import type { Currency } from "../types";
import { useInvalidate } from "./useInvalidate";

export function usePrefs() {
  return useQuery({ queryKey: ["prefs"], queryFn: getPrefs });
}

/**
 * Switch the base currency every total is reported in.
 *
 * The server re-scales the stored exchange rates so each keeps meaning "1 unit
 * = rate units of base", and rejects the switch outright (400, with an
 * actionable `detail`) when there's no rate for the incoming base to pivot on —
 * so callers should surface `ApiError.detail` rather than a generic failure.
 */
export function useUpdateBaseCurrency() {
  const inv = useInvalidate();
  return useMutation({
    mutationKey: ["updatePrefs"],
    mutationFn: (base_currency: Currency) => updatePrefs({ base_currency }),
    onSuccess: () => inv.baseCurrencyChanged(),
  });
}
