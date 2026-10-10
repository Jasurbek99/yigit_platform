import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import { IDEMPOTENCY_HEADER } from '@/hooks/useIdempotencyKey';
import type { IBuyer, IBuyerInput } from '../types';
import { BUYERS_KEY } from './lotKeys';
import { useTargetKey } from './useTargetKey';

const BUYERS = '/market/buyers/';

/** GET /market/buyers/?q= (plain array, max 20) — the debt buyer autocomplete. */
export function useBuyers(q: string): UseQueryResult<IBuyer[]> {
  const query = q.trim();
  return useQuery({
    queryKey: [...BUYERS_KEY, query],
    queryFn: async () => (await api.get<IBuyer[]>(BUYERS, { params: { q: query } })).data,
    // Keep the previous suggestions on screen while the next letter's answer loads.
    placeholderData: (previous) => previous,
  });
}

/** POST /market/buyers/ — the buyer with this name (any case); created when new. */
export function useCreateBuyer(): UseMutationResult<IBuyer, unknown, IBuyerInput> {
  const queryClient = useQueryClient();
  const idem = useTargetKey();
  return useMutation({
    mutationFn: async (body: IBuyerInput) => (
      await api.post<IBuyer>(BUYERS, body, { headers: { [IDEMPOTENCY_HEADER]: idem.keyFor(body.name.trim()) } })
    ).data,
    onSuccess: () => {
      idem.reset();
      void queryClient.invalidateQueries({ queryKey: BUYERS_KEY });
    },
  });
}
