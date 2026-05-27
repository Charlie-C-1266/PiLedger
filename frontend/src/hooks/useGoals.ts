import { useQuery } from "@tanstack/react-query";
import { getGoals } from "../api/client";

export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: getGoals });
}
