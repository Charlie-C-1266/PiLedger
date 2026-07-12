import { useQuery } from "@tanstack/react-query";
import { getTokens } from "../api/client";

export function useTokens() {
  return useQuery({ queryKey: ["tokens"], queryFn: getTokens });
}
