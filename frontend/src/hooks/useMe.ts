import { useQuery } from "@tanstack/react-query";
import { getMe } from "../api/client";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe });
}
