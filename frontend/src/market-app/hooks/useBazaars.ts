import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import { TEAM_KEY, TEAM_PAGE } from './teamKeys';

export interface IBazaar {
  id: number;
  name: string;
  city_id: number | null;
  is_active: boolean;
}

/** POST body without `id`; PATCH `<id>/` with it. */
export interface IBazaarWrite {
  id?: number;
  name?: string;
  city_id?: number | null;
  is_active?: boolean;
}

const BAZAARS = '/market/team/bazaars/';

export function useBazaars(): UseQueryResult<IBazaar[]> {
  return useQuery({
    queryKey: [...TEAM_KEY, 'bazaars'],
    queryFn: async () => (await api.get<IApiListResponse<IBazaar>>(BAZAARS, TEAM_PAGE)).data.results,
  });
}

export function useSaveBazaar(): UseMutationResult<void, Error, IBazaarWrite> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: IBazaarWrite) => {
      await (id ? api.patch(`${BAZAARS}${id}/`, body) : api.post(BAZAARS, body));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAM_KEY }),
  });
}
