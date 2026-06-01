import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEnvelope,
  createGroup,
  createIncome,
  deleteEnvelope,
  deleteGroup,
  deleteIncome,
  getBudget,
  updateEnvelope,
  updateGroup,
  updateIncome,
} from "../api/client";
import type { Budget } from "../types";

export function useBudget() {
  return useQuery({ queryKey: ["budget"], queryFn: getBudget });
}

/**
 * Live-edit helper for the slider/stepper controls. `patch` rewrites the cached
 * `["budget"]` payload synchronously so every derived figure (income total,
 * hero, balance bar, donut…) re-renders immediately, while `persist` debounces
 * the matching API write (~400ms, like the Goals slider) and reconciles with
 * the server on success. Debounce timers are keyed so independent rows don't
 * cancel each other.
 */
export function useBudgetEdit() {
  const queryClient = useQueryClient();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const patch = useCallback(
    (updater: (b: Budget) => Budget) => {
      queryClient.setQueryData<Budget>(["budget"], (prev) =>
        prev ? updater(prev) : prev
      );
    },
    [queryClient]
  );

  const persist = useCallback(
    (key: string, write: () => Promise<unknown>) => {
      const existing = timers.current[key];
      if (existing) clearTimeout(existing);
      timers.current[key] = setTimeout(() => {
        void write().then(() =>
          queryClient.invalidateQueries({ queryKey: ["budget"] })
        );
      }, 400);
    },
    [queryClient]
  );

  return { patch, persist };
}

/** Wrap a budget write so it refetches the aggregate on success. Every budget
 *  mutation touches derived totals (allocated, spent, safe-to-spend…), so the
 *  whole `["budget"]` payload is invalidated rather than patched in place. */
function useBudgetMutation<TVars, TData>(mutationFn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["budget"] }),
  });
}

export const useCreateIncome = () => useBudgetMutation(createIncome);
export const useUpdateIncome = () =>
  useBudgetMutation((v: { id: number; data: Parameters<typeof updateIncome>[1] }) =>
    updateIncome(v.id, v.data)
  );
export const useDeleteIncome = () => useBudgetMutation(deleteIncome);

export const useCreateGroup = () => useBudgetMutation(createGroup);
export const useUpdateGroup = () =>
  useBudgetMutation((v: { id: number; data: Parameters<typeof updateGroup>[1] }) =>
    updateGroup(v.id, v.data)
  );
export const useDeleteGroup = () => useBudgetMutation(deleteGroup);

export const useCreateEnvelope = () => useBudgetMutation(createEnvelope);
export const useUpdateEnvelope = () =>
  useBudgetMutation((v: { id: number; data: Parameters<typeof updateEnvelope>[1] }) =>
    updateEnvelope(v.id, v.data)
  );
export const useDeleteEnvelope = () => useBudgetMutation(deleteEnvelope);
