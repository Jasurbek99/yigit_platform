import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import { IDEMPOTENCY_HEADER } from '@/hooks/useIdempotencyKey';
import type { IApiListResponse } from '@/types';
import type { ILot, LotState } from '../types';
import { LOTS_KEY, SHIPMENTS_KEY, lotsKey } from './lotKeys';
import { useTargetKey } from './useTargetKey';

/** One page holds an agent's lots for a long while; past 200 the oldest are not shown. */
const LOTS_PAGE_SIZE = 200;

/** GET /market/lots/?state= — newest first. */
export function useLots(state: LotState): UseQueryResult<ILot[]> {
  return useQuery({
    queryKey: lotsKey(state),
    queryFn: async () => (
      await api.get<IApiListResponse<ILot>>('/market/lots/', { params: { state, page_size: LOTS_PAGE_SIZE } })
    ).data.results,
  });
}

export interface IOpenLotInput {
  shipment_id: number;
}

/** POST /market/lots/open/ — the agent opens a truck or a seller claims it by QR; same lot on a repeat. */
export function useOpenLot(): UseMutationResult<ILot, unknown, IOpenLotInput> {
  const queryClient = useQueryClient();
  const idem = useTargetKey();
  return useMutation({
    mutationFn: async (body: IOpenLotInput) => (
      await api.post<ILot>('/market/lots/open/', body, {
        headers: { [IDEMPOTENCY_HEADER]: idem.keyFor(String(body.shipment_id)) },
      })
    ).data,
    onSuccess: () => {
      idem.reset();
      void queryClient.invalidateQueries({ queryKey: LOTS_KEY });
      void queryClient.invalidateQueries({ queryKey: SHIPMENTS_KEY });
    },
  });
}
