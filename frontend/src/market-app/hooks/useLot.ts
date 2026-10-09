import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import { IDEMPOTENCY_HEADER, useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import type { ILot, ILotDetail, ILotUpdateInput } from '../types';
import { applyLot, lotKey } from './lotKeys';

/** GET /market/lots/{id}/ — the lot with its sales, spoilage and expenses. */
export function useLot(id: number): UseQueryResult<ILotDetail> {
  return useQuery({
    queryKey: lotKey(id),
    queryFn: async () => (await api.get<ILotDetail>(`/market/lots/${id}/`)).data,
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** PATCH /market/lots/{id}/ — the agent's receipt and seller. */
export function useUpdateLot(id: number): UseMutationResult<ILot, unknown, ILotUpdateInput> {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async (body: ILotUpdateInput) => (
      await api.patch<ILot>(`/market/lots/${id}/`, body, { headers: { [IDEMPOTENCY_HEADER]: idem.key } })
    ).data,
    onSuccess: (lot) => {
      idem.reset();
      applyLot(queryClient, lot);
    },
  });
}
