import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IQuotaDashboardResponse, IQuotaIssuance, IApiListResponse } from '@/types';

export interface IQuotaDashboardFilters {
  season: number;
  date_from?: string;
  date_to?: string;
  product_type?: string;
}

export function useQuotaDashboard(
  filters: IQuotaDashboardFilters,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
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
    // Gate by season AND quota access: a seller reaches this page only for the
    // local-sell tab and has no quota_issuance perm, so firing the dashboard
    // query would 403 and surface the error banner. The caller passes enabled.
    enabled: !!filters.season && enabled,
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

export interface IFirmQuotaBalance {
  issued_kg: number;
  used_kg: number;
  remaining_kg: number;
}

/**
 * Per-firm remaining quota (issued − approved-used) for the active season,
 * keyed by export_firm id (as a string). Firms absent from the map have no
 * allocation → treat as zero remaining. Powers the firm-split editor's soft
 * "no quota" warning. Gated by quota_issuance view on the backend, so only
 * the roles that can edit firm splits fetch it (others pass enabled=false).
 */
export function useQuotaFirmBalances(
  productType: string,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['quota-firm-balances', productType],
    queryFn: async (): Promise<Record<string, IFirmQuotaBalance>> => {
      const { data } = await api.get<Record<string, IFirmQuotaBalance>>(
        `/export/quota-firm-balances/?product_type=${encodeURIComponent(productType)}`,
      );
      return data;
    },
    enabled,
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
      // Sheet firm-split editor reads these to hard-block no-quota firms; a new
      // issuance raises a firm's remaining, so refetch or it stays unselectable.
      qc.invalidateQueries({ queryKey: ['quota-firm-balances'] });
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
      // Deleting a firm's only issuance drops its remaining to 0 → it must go
      // back to unselectable on the Sheet; refetch the balances.
      qc.invalidateQueries({ queryKey: ['quota-firm-balances'] });
    },
  });
}
