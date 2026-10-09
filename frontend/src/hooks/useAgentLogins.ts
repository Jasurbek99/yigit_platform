import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

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

const KEY = ['market', 'agents'] as const;

export function useAgentLogins() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<{ results: IAgentLogin[] }>('/market/agents/')).data.results,
  });
}

export function useCreateAgentLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: IAgentLoginCreate) => (await api.post<IAgentLogin>('/market/agents/', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateAgentLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; is_active?: boolean; password?: string; first_name?: string }) =>
      (await api.patch<IAgentLogin>(`/market/agents/${id}/`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
