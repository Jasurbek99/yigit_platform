import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IQuotaUsageRecord } from '@/types';

interface IUsageFilters {
  status?: string;
  product_type?: string;
  date_from?: string;
  date_to?: string;
}

export function useQuotaUsageRecords(filters: IUsageFilters = {}, options?: { enabled?: boolean }) {
  return useQuery<IQuotaUsageRecord[]>({
    queryKey: ['quota-usage', filters],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.product_type) params.set('product_type', filters.product_type);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      const { data } = await api.get(`/export/quota-usage/?${params}`);
      return Array.isArray(data) ? data : data.results ?? [];
    },
    staleTime: 30_000,
  });
}

export function useCreateQuotaUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      usage_date: string;
      export_firm: number;
      kg_used: number;
      product_type?: string;
      notes?: string;
    }) => {
      const { data } = await api.post('/export/quota-usage/', payload);
      return data as IQuotaUsageRecord;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota-usage'] });
      qc.invalidateQueries({ queryKey: ['quota-issuances'] });
    },
  });
}

export function useUpdateQuotaUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number } & Partial<IQuotaUsageRecord>) => {
      const { id, ...body } = payload;
      const { data } = await api.patch(`/export/quota-usage/${id}/`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quota-usage'] }),
  });
}

export function useDeleteQuotaUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/export/quota-usage/${id}/`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quota-usage'] }),
  });
}

export function useBulkApproveQuotaUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const { data } = await api.post('/export/quota-usage/approve/', { ids });
      return data as { approved: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota-usage'] });
      qc.invalidateQueries({ queryKey: ['quota-issuances'] });
    },
  });
}
