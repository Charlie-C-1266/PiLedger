import { useQuery } from "@tanstack/react-query";
import { getAllHistory } from "../api/client";
import type { RangeKey } from "../types";

// Mirrors the backend RANGE_TO_DAYS map. `/api/history/all` takes ?days=, while
// the shared RangePills speak the 7D/30D/90D/1Y range keys, so map here.
export const RANGE_TO_DAYS: Record<RangeKey, number> = {
  "7D": 7,
  "30D": 30,
  "90D": 90,
  "1Y": 365,
};

export function useAllHistory(range: RangeKey = "90D") {
  const days = RANGE_TO_DAYS[range];
  return useQuery({
    queryKey: ["history-all", days],
    queryFn: () => getAllHistory(days),
  });
}
