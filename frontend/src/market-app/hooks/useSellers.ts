import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import { TEAM_KEY, TEAM_PAGE } from './teamKeys';

export interface ISeller {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  bazaar: { id: number; name: string } | null;
}

/** POST body without `id`; PATCH `<id>/` with it. */
export interface ISellerWrite {
  id?: number;
  username?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  bazaar_id?: number;
}

const SELLERS = '/market/team/sellers/';

export function useSellers(): UseQueryResult<ISeller[]> {
  return useQuery({
    queryKey: [...TEAM_KEY, 'sellers'],
    queryFn: async () => (await api.get<IApiListResponse<ISeller>>(SELLERS, TEAM_PAGE)).data.results,
  });
}

export function useSaveSeller(): UseMutationResult<void, Error, ISellerWrite> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: ISellerWrite) => {
      await (id ? api.patch(`${SELLERS}${id}/`, body) : api.post(SELLERS, body));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAM_KEY }),
  });
}
