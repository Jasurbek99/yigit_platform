import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IQuotaDashboardResponse, IQuotaIssuance, IApiListResponse } from '@/types';

export interface IQuotaDashboardFilters {
  season: number;
  date_from?: string;
  date_to?: string;
  product_type?: string;
}

export function useQuotaDashboard(filters: IQuotaDashboardFilters) {
  return useQuery({
    queryKey: ['quota-dashboard', filters],
    queryFn: async (): Promise<IQuotaDashboardResponse> => {
      const params = new URLSearchParams();
      params.set('season', String(filters.season));
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (filters.product_type) params.set('product_type', filters.product_type);
      const { data } = await api.get<IQuotaDashboardResponse>(`/export/quota-dashboard/?${params}`);
      return data;
    },
    enabled: !!filters.season,
    staleTime: 60_000,
  });
}

export function useQuotaIssuances(
  filters: { product_type?: string; date_from?: string; date_to?: string } = {},
) {
  return useQuery({
    queryKey: ['quota-issuances', filters],
    queryFn: async (): Promise<IQuotaIssuance[]> => {
      const params = new URLSearchParams();
      if (filters.product_type) params.set('product_type', filters.product_type);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      const qs = params.toString() ? `?${params}` : '';
      const { data } = await api.get<IApiListResponse<IQuotaIssuance> | IQuotaIssuance[]>(
        `/export/quota-issuances/${qs}`,
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

export interface ICreateIssuancePayload {
  issue_date: string;
  product_type: string;
  validity: string;
  notes?: string;
  allocations: Array<{ export_firm: number; kg_quota: number }>;
}

export function useCreateQuotaIssuance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ICreateIssuancePayload): Promise<IQuotaIssuance> => {
      const { data } = await api.post<IQuotaIssuance>('/export/quota-issuances/', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota-issuances'] });
      qc.invalidateQueries({ queryKey: ['quota-dashboard'] });
    },
  });
}

export function useDeleteQuotaIssuance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/export/quota-issuances/${id}/`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota-issuances'] });
      qc.invalidateQueries({ queryKey: ['quota-dashboard'] });
    },
  });
}
