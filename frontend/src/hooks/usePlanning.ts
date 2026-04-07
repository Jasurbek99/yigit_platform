import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  IApiListResponse,
  IWeeklyHarvestPlan,
  IQuotaDashboardItem,
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
        console.log('[useUpsertHarvestPlan] PATCH', `/export/harvest-plans/${payload.id}/`, payload);
        const { data } = await api.patch<IWeeklyHarvestPlan>(`/export/harvest-plans/${payload.id}/`, payload);
        return data;
      }
      console.log('[useUpsertHarvestPlan] POST', '/export/harvest-plans/', payload);
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

export function useQuotaDashboard(seasonId?: number) {
  return useQuery({
    queryKey: ['quota-dashboard', seasonId],
    queryFn: async (): Promise<IQuotaDashboardItem[]> => {
      if (USE_MOCK) return MOCK_QUOTA_DASHBOARD;
      const params = seasonId ? `?season=${seasonId}` : '';
      const { data } = await api.get<IQuotaDashboardItem[]>(`/export/quotas/dashboard/${params}`);
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
