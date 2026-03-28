import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import {
  MOCK_ADVANCES_RESPONSE,
  MOCK_ADVANCE_DETAILS,
} from '@/mock/advances';
import type {
  IApiListResponse,
  IFinansistAdvanceListItem,
  IFinansistAdvanceDetail,
} from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export interface IAdvanceFilters {
  page?: number;
  page_size?: number;
  reconciled?: boolean;
  search?: string;
}

export function useAdvances(filters: IAdvanceFilters = {}) {
  return useQuery({
    queryKey: ['advances', filters],
    queryFn: async (): Promise<IApiListResponse<IFinansistAdvanceListItem>> => {
      if (USE_MOCK) {
        const results =
          filters.reconciled === undefined
            ? MOCK_ADVANCES_RESPONSE.results
            : MOCK_ADVANCES_RESPONSE.results.filter(
                (a) => a.reconciled === filters.reconciled,
              );
        return { ...MOCK_ADVANCES_RESPONSE, results, count: results.length };
      }

      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.page_size) params.set('page_size', String(filters.page_size));
      if (filters.reconciled !== undefined)
        params.set('reconciled', String(filters.reconciled));
      if (filters.search) params.set('search', filters.search);

      const { data } = await api.get<IApiListResponse<IFinansistAdvanceListItem>>(
        `/export/advances/?${params.toString()}`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}

export function useAdvanceDetail(id: number) {
  return useQuery({
    queryKey: ['advances', id],
    queryFn: async (): Promise<IFinansistAdvanceDetail> => {
      if (USE_MOCK) {
        const detail = MOCK_ADVANCE_DETAILS[id];
        if (!detail) throw new Error(`Advance ${id} not found`);
        return detail;
      }
      const { data } = await api.get<IFinansistAdvanceDetail>(
        `/export/advances/${id}/`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}

export function useReconcileAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IFinansistAdvanceDetail> => {
      const { data } = await api.patch<IFinansistAdvanceDetail>(
        `/export/advances/${id}/reconcile/`,
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['advances'] });
      queryClient.setQueryData(['advances', data.id], data);
    },
  });
}

export interface ICreateAdvancePayload {
  batch_code?: string | null;
  advance_date: string;
  total_amount: number;
  currency: string;
  purpose?: string | null;
  notes?: string | null;
  shipment_ids?: number[];
}

export function useCreateAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: ICreateAdvancePayload,
    ): Promise<IFinansistAdvanceDetail> => {
      const { data } = await api.post<IFinansistAdvanceDetail>(
        '/export/advances/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances'] });
    },
  });
}
