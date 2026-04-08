import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  IApiListResponse,
  IWeeklyHarvestPlan,
  IQuotaAllocation,
  IQuotaFirmSummary,
  IPriceEntry,
  IWeeklyTruckAllocation,
  ITruckDestination,
  IBlockSummary,
  IDomesticSale,
} from '@/types';
import {
  MOCK_HARVEST_PLANS,
  MOCK_QUOTA_DASHBOARD,
  MOCK_PRICE_ENTRIES,
  MOCK_TRUCK_ALLOCATIONS,
  MOCK_BLOCK_SUMMARY,
  MOCK_DOMESTIC_SALES,
} from '@/mock/planning';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export function useHarvestPlans(filters: { season?: number; year?: number; week?: number } = {}) {
  return useQuery({
    queryKey: ['harvest-plans', filters],
    queryFn: async (): Promise<IApiListResponse<IWeeklyHarvestPlan>> => {
      if (USE_MOCK) return { count: MOCK_HARVEST_PLANS.length, next: null, previous: null, results: MOCK_HARVEST_PLANS };
      const params = new URLSearchParams();
      if (filters.season) params.set('season', String(filters.season));
      if (filters.year) params.set('year', String(filters.year));
      if (filters.week) params.set('week', String(filters.week));
      const { data } = await api.get<IApiListResponse<IWeeklyHarvestPlan>>(`/export/harvest-plans/?${params}`);
      return data;
    },
    staleTime: 60_000,
  });
}

export function useUpsertHarvestPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Partial<IWeeklyHarvestPlan> & { id?: number }): Promise<IWeeklyHarvestPlan> => {
      if (USE_MOCK) {
        return { ...payload, id: payload.id ?? Date.now() } as IWeeklyHarvestPlan;
      }
      if (payload.id) {
        const { data } = await api.patch<IWeeklyHarvestPlan>(`/export/harvest-plans/${payload.id}/`, payload);
        return data;
      }
      const { data } = await api.post<IWeeklyHarvestPlan>('/export/harvest-plans/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useInitializeWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { season: number; week_number: number; year: number }): Promise<IApiListResponse<IWeeklyHarvestPlan>> => {
      const { data } = await api.post<IApiListResponse<IWeeklyHarvestPlan>>(
        '/export/harvest-plans/initialize-week/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useSubmitHarvestPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IWeeklyHarvestPlan> => {
      const { data } = await api.post<IWeeklyHarvestPlan>(`/export/harvest-plans/${id}/submit/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useApproveHarvestPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IWeeklyHarvestPlan> => {
      const { data } = await api.post<IWeeklyHarvestPlan>(`/export/harvest-plans/${id}/approve/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useRejectHarvestPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number; rejection_note: string }): Promise<IWeeklyHarvestPlan> => {
      const { data } = await api.post<IWeeklyHarvestPlan>(
        `/export/harvest-plans/${payload.id}/reject/`,
        { rejection_note: payload.rejection_note },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useBulkSubmitHarvestPlans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]): Promise<{ submitted: number[]; errors: Array<{ id: number; error: string }> }> => {
      const { data } = await api.post('/export/harvest-plans/bulk-submit/', { ids });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useBulkApproveHarvestPlans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]): Promise<{ approved: number[]; errors: Array<{ id: number; error: string }> }> => {
      const { data } = await api.post('/export/harvest-plans/bulk-approve/', { ids });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useBulkRejectHarvestPlans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { ids: number[]; rejection_note: string }): Promise<{ rejected: number[]; errors: Array<{ id: number; error: string }> }> => {
      const { data } = await api.post('/export/harvest-plans/bulk-reject/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useQuotaDashboard(filters: { export_firm?: number; status?: string } = {}) {
  return useQuery({
    queryKey: ['quota-dashboard', filters],
    queryFn: async (): Promise<IQuotaAllocation[]> => {
      if (USE_MOCK) return MOCK_QUOTA_DASHBOARD;
      const params = new URLSearchParams();
      if (filters.export_firm) params.set('export_firm', String(filters.export_firm));
      if (filters.status) params.set('status', filters.status);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const { data } = await api.get<IQuotaAllocation[]>(`/export/quotas/dashboard/${qs}`);
      return data;
    },
    staleTime: 60_000,
  });
}

export interface IQuotaFormData {
  export_firm: number;
  domestic_sale_kg: number;
  domestic_sale_date?: string | null;
  expected_kg: number;
  granted_kg: number;
  valid_from: string;
  valid_to: string;
  notes?: string;
}

export function useCreateQuota() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IQuotaFormData): Promise<IQuotaAllocation> => {
      const { data } = await api.post<IQuotaAllocation>('/export/quotas/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quota-dashboard'] });
    },
  });
}

export function useUpdateQuota() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: IQuotaFormData & { id: number }): Promise<IQuotaAllocation> => {
      const { data } = await api.put<IQuotaAllocation>(`/export/quotas/${id}/`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quota-dashboard'] });
    },
  });
}

export function useDeleteQuota() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/export/quotas/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quota-dashboard'] });
    },
  });
}

const MOCK_QUOTA_FIRM_SUMMARY: IQuotaFirmSummary[] = [
  { export_firm: 1, export_firm_name: 'Durli Miweler HJ', export_firm_code: 'F005', quota_count: 3, active_count: 2, expired_count: 1, exhausted_count: 0, total_domestic_sale_kg: 5500, total_expected_kg: 55000, total_granted_kg: 45000, total_difference_kg: -10000, total_used_kg: 28000, total_remaining_kg: 17000, utilization_pct: 62.2, earliest_expiry: '2026-04-30' },
  { export_firm: 2, export_firm_name: 'Gulbahar HJ', export_firm_code: 'F003', quota_count: 2, active_count: 1, expired_count: 0, exhausted_count: 1, total_domestic_sale_kg: 4000, total_expected_kg: 40000, total_granted_kg: 35000, total_difference_kg: -5000, total_used_kg: 32000, total_remaining_kg: 3000, utilization_pct: 91.4, earliest_expiry: '2026-04-30' },
  { export_firm: 3, export_firm_name: 'Altyn Asyr', export_firm_code: 'F010', quota_count: 1, active_count: 1, expired_count: 0, exhausted_count: 0, total_domestic_sale_kg: 2000, total_expected_kg: 20000, total_granted_kg: 20000, total_difference_kg: 0, total_used_kg: 5000, total_remaining_kg: 15000, utilization_pct: 25.0, earliest_expiry: '2026-05-15' },
];

export function useQuotaFirmSummary() {
  return useQuery({
    queryKey: ['quota-firm-summary'],
    queryFn: async (): Promise<IQuotaFirmSummary[]> => {
      if (USE_MOCK) return MOCK_QUOTA_FIRM_SUMMARY;
      const { data } = await api.get<IQuotaFirmSummary[]>('/export/quotas/firm-summary/');
      return data;
    },
    staleTime: 60_000,
  });
}

export function usePriceEntries(days = 7) {
  return useQuery({
    queryKey: ['price-entries', days],
    queryFn: async (): Promise<IPriceEntry[]> => {
      if (USE_MOCK) return MOCK_PRICE_ENTRIES;
      const { data } = await api.get<IApiListResponse<IPriceEntry>>(`/export/prices/?days=${days}&page_size=500`);
      return data.results;
    },
    staleTime: 300_000,
  });
}

export function useTruckAllocations(
  filters: { season?: number; year?: number; week_number?: number } = {},
) {
  return useQuery({
    queryKey: ['truck-allocations', filters],
    queryFn: async (): Promise<IApiListResponse<IWeeklyTruckAllocation>> => {
      if (USE_MOCK) {
        return {
          count: MOCK_TRUCK_ALLOCATIONS.length,
          next: null,
          previous: null,
          results: MOCK_TRUCK_ALLOCATIONS,
        };
      }
      const params = new URLSearchParams();
      if (filters.season) params.set('season', String(filters.season));
      if (filters.year) params.set('year', String(filters.year));
      if (filters.week_number) params.set('week_number', String(filters.week_number));
      const { data } = await api.get<IApiListResponse<IWeeklyTruckAllocation>>(
        `/export/truck-allocations/?${params}`,
      );
      return data;
    },
    staleTime: 60_000,
  });
}

export function useTruckDestinations() {
  return useQuery({
    queryKey: ['truck-destinations'],
    queryFn: async (): Promise<ITruckDestination[]> => {
      const { data } = await api.get<ITruckDestination[] | IApiListResponse<ITruckDestination>>(
        '/core/truck-destinations/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

export function useUpsertTruckAllocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<IWeeklyTruckAllocation> & { id?: number }): Promise<IWeeklyTruckAllocation> => {
      if (payload.id) {
        const { data } = await api.patch<IWeeklyTruckAllocation>(`/export/truck-allocations/${payload.id}/`, payload);
        return data;
      }
      const { data } = await api.post<IWeeklyTruckAllocation>('/export/truck-allocations/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['truck-allocations'] });
    },
  });
}

export function useSetTruckSplits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      allocationId: number;
      splits: Array<{ destination_id: number; truck_count: number }>;
    }): Promise<IWeeklyTruckAllocation> => {
      const { data } = await api.post<IWeeklyTruckAllocation>(
        `/export/truck-allocations/${payload.allocationId}/set-splits/`,
        { splits: payload.splits },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['truck-allocations'] });
    },
  });
}

export function useBlockSummary(
  filters: { season?: number; year?: number; week_number?: number } = {},
) {
  return useQuery({
    queryKey: ['block-summary', filters],
    queryFn: async (): Promise<IBlockSummary[]> => {
      if (USE_MOCK) return MOCK_BLOCK_SUMMARY;
      const params = new URLSearchParams();
      if (filters.season) params.set('season', String(filters.season));
      if (filters.year) params.set('year', String(filters.year));
      if (filters.week_number) params.set('week_number', String(filters.week_number));
      const { data } = await api.get<IBlockSummary[]>(
        `/export/harvest-plans/block-summary/?${params}`,
      );
      return data;
    },
    staleTime: 60_000,
  });
}

export function useDomesticSales(
  filters: { block?: number; buyer?: number; page?: number } = {},
) {
  return useQuery({
    queryKey: ['domestic-sales', filters],
    queryFn: async (): Promise<IApiListResponse<IDomesticSale>> => {
      if (USE_MOCK) {
        return {
          count: MOCK_DOMESTIC_SALES.length,
          next: null,
          previous: null,
          results: MOCK_DOMESTIC_SALES,
        };
      }
      const params = new URLSearchParams();
      if (filters.block) params.set('block', String(filters.block));
      if (filters.buyer) params.set('buyer', String(filters.buyer));
      if (filters.page) params.set('page', String(filters.page));
      params.set('page_size', '1000');
      const { data } = await api.get<IApiListResponse<IDomesticSale>>(
        `/export/domestic-sales/?${params}`,
      );
      return data;
    },
    staleTime: 60_000,
  });
}
