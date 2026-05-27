import { useQuery } from "@tanstack/react-query";
import { getNetWorthSeries } from "../api/client";
import type { RangeKey } from "../types";

export function useNetWorthSeries(range: RangeKey = "30D") {
  return useQuery({
    queryKey: ["networth", range],
    queryFn: () => getNetWorthSeries(range),
  });
}
