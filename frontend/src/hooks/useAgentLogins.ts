import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';

export interface IAgentLogin {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  customer: { id: number; name: string };
}

export interface IAgentLoginCreate {
  customer_id: number;
  username: string;
  password: string;
  first_name: string;
  last_name?: string;
}

/** PATCH body: the login's `id` plus the fields to change. */
export interface IAgentLoginUpdate {
  id: number;
  is_active?: boolean;
  password?: string;
  first_name?: string;
}

const KEY: readonly string[] = ['market', 'agents'];

export function useAgentLogins(): UseQueryResult<IAgentLogin[]> {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<IApiListResponse<IAgentLogin>>('/market/agents/')).data.results,
  });
}

export function useCreateAgentLogin(): UseMutationResult<IAgentLogin, Error, IAgentLoginCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: IAgentLoginCreate) => (await api.post<IAgentLogin>('/market/agents/', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateAgentLogin(): UseMutationResult<IAgentLogin, Error, IAgentLoginUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: IAgentLoginUpdate) =>
      (await api.patch<IAgentLogin>(`/market/agents/${id}/`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
