import { useQuery } from "@tanstack/react-query";
import { getProjections } from "../api/client";

/** Savings-account projections `months` ahead. Defaults to a 5-year (60-month)
 * horizon so the chart spans the 1/2/5-year milestones the cards call out. */
export function useProjections(months = 60) {
  return useQuery({
    queryKey: ["projections", months],
    queryFn: () => getProjections(months),
  });
}
