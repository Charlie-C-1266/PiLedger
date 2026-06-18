import { useQuery } from "@tanstack/react-query";
import { getSubscriptions, getOccurrences } from "../api/client";

export function useSubscriptions() {
  return useQuery({ queryKey: ["subscriptions"], queryFn: getSubscriptions });
}

/** Expanded calendar occurrences for a window. Keyed by the window so paging
 * between months caches each month independently. */
export function useOccurrences(from: string, to: string) {
  return useQuery({
    queryKey: ["occurrences", from, to],
    queryFn: () => getOccurrences(from, to),
  });
}
