import { useQuery } from "@tanstack/react-query";
import { getTransactions } from "../api/client";
import type { TransactionFilters } from "../types";

export function useTransactions(filters?: TransactionFilters) {
  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => getTransactions(filters),
  });
}
