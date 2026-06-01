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

export function useBudget() {
  return useQuery({ queryKey: ["budget"], queryFn: getBudget });
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
