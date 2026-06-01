import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  IApiListResponse,
  IWeeklyHarvestPlan,
  IWeeklyLocalSellPlan,
  IPriceEntry,
  IWeeklyTruckAllocation,
  ITruckDestination,
  IBlockSummary,
  IDomesticSale,
  IHarvestDayEntry,
  IDayEntryHistoryItem,
} from '@/types';
import {
  MOCK_HARVEST_PLANS,
  MOCK_DAY_ENTRIES,
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
      params.set('page_size', '200');
      const { data } = await api.get<IApiListResponse<IWeeklyHarvestPlan>>(`/greenhouse/harvest-plans/?${params}`);
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
        const { data } = await api.patch<IWeeklyHarvestPlan>(`/greenhouse/harvest-plans/${payload.id}/`, payload);
        return data;
      }
      const { data } = await api.post<IWeeklyHarvestPlan>('/greenhouse/harvest-plans/', payload);
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
        '/greenhouse/harvest-plans/initialize-week/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Weekly Local Sell Plans
// ---------------------------------------------------------------------------

export function useLocalSellPlans(filters: { year?: number; week?: number } = {}) {
  return useQuery({
    queryKey: ['local-sell-plans', filters],
    queryFn: async (): Promise<IApiListResponse<IWeeklyLocalSellPlan>> => {
      const params = new URLSearchParams();
      if (filters.year) params.set('year', String(filters.year));
      if (filters.week) params.set('week', String(filters.week));
      params.set('page_size', '200');
      const { data } = await api.get<IApiListResponse<IWeeklyLocalSellPlan>>(`/export/local-sell-plans/?${params.toString()}`);
      return data;
    },
    staleTime: 60_000,
  });
}

export function useUpsertLocalSellPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<IWeeklyLocalSellPlan> & { id?: number }): Promise<IWeeklyLocalSellPlan> => {
      if (payload.id) {
        const { data } = await api.patch<IWeeklyLocalSellPlan>(`/export/local-sell-plans/${payload.id}/`, payload);
        return data;
      }
      const { data } = await api.post<IWeeklyLocalSellPlan>('/export/local-sell-plans/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-sell-plans'] });
    },
  });
}

export function useInitializeLocalSellWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { week_number: number; year: number; season?: number }) => {
      const { data } = await api.post('/export/local-sell-plans/initialize-week/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-sell-plans'] });
    },
  });
}

export function useSubmitLocalSellPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IWeeklyLocalSellPlan> => {
      const { data } = await api.post<IWeeklyLocalSellPlan>(`/export/local-sell-plans/${id}/submit/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-sell-plans'] });
    },
  });
}

export function useApproveLocalSellPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IWeeklyLocalSellPlan> => {
      const { data } = await api.post<IWeeklyLocalSellPlan>(`/export/local-sell-plans/${id}/approve/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-sell-plans'] });
    },
  });
}

export function useRejectLocalSellPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number; rejection_note: string }): Promise<IWeeklyLocalSellPlan> => {
      const { data } = await api.post<IWeeklyLocalSellPlan>(
        `/export/local-sell-plans/${payload.id}/reject/`,
        { rejection_note: payload.rejection_note },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-sell-plans'] });
    },
  });
}

export function useBulkSubmitLocalSellPlans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const { data } = await api.post('/export/local-sell-plans/bulk-submit/', { ids });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-sell-plans'] });
    },
  });
}

export function useBulkApproveLocalSellPlans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const { data } = await api.post('/export/local-sell-plans/bulk-approve/', { ids });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-sell-plans'] });
    },
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
      params.set('page_size', '200');
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
        '/core/truck-destinations/?is_active=true&page_size=200',
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
      if (filters.week_number) params.set('week', String(filters.week_number));
      const { data } = await api.get<IBlockSummary[]>(
        `/greenhouse/harvest-plans/block-summary/?${params}`,
      );
      return data;
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Harvest Day Entries (Forecast Layer)
// ---------------------------------------------------------------------------

export function useDayEntries(
  filters: { weekly_plan?: number; block?: number; season?: number; date_from?: string; date_to?: string } = {},
) {
  return useQuery({
    queryKey: ['day-entries', filters],
    queryFn: async (): Promise<IHarvestDayEntry[]> => {
      if (USE_MOCK) {
        // Filter mock data to match the requested filters
        return MOCK_DAY_ENTRIES.filter((e) => {
          if (filters.season !== undefined && e.season !== filters.season) return false;
          if (filters.block !== undefined && e.block !== filters.block) return false;
          if (filters.weekly_plan !== undefined && e.weekly_plan !== filters.weekly_plan) return false;
          if (filters.date_from !== undefined && e.entry_date < filters.date_from) return false;
          if (filters.date_to !== undefined && e.entry_date > filters.date_to) return false;
          return true;
        });
      }
      const params = new URLSearchParams();
      if (filters.weekly_plan) params.set('weekly_plan', String(filters.weekly_plan));
      if (filters.block) params.set('block', String(filters.block));
      if (filters.season) params.set('season', String(filters.season));
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      // 15 blocks × 7 days = 105 cells per week; default DRF page is 50, which
      // would silently drop Fri/Sat. Request the upper bound — backend caps at 200.
      params.set('page_size', '200');
      const { data } = await api.get<IApiListResponse<IHarvestDayEntry> | IHarvestDayEntry[]>(
        `/greenhouse/day-entries/?${params}`,
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 30_000,
  });
}

export function useUpsertDayEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id?: number;
      plan_value?: number | null;
      forecast_value?: number | null;
      actual_value?: number | null;
      reason?: string;
    }): Promise<IHarvestDayEntry> => {
      if (payload.id) {
        const { data } = await api.patch<IHarvestDayEntry>(
          `/greenhouse/day-entries/${payload.id}/`,
          payload,
        );
        return data;
      }
      const { data } = await api.post<IHarvestDayEntry>('/greenhouse/day-entries/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['day-entries'] });
    },
  });
}

export function useDayEntryHistory(entryId: number | null) {
  return useQuery({
    queryKey: ['day-entry-history', entryId],
    queryFn: async (): Promise<IDayEntryHistoryItem[]> => {
      if (!entryId) return [];
      const { data } = await api.get<IDayEntryHistoryItem[]>(
        `/greenhouse/day-entries/${entryId}/history/`,
      );
      return data;
    },
    enabled: entryId !== null,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Late-edit extension (admin only)
// ---------------------------------------------------------------------------

export function useGrantLateEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id: number;
      granted_until: string;
      reason: string;
    }): Promise<IWeeklyHarvestPlan> => {
      const { data } = await api.post<IWeeklyHarvestPlan>(
        `/greenhouse/harvest-plans/${payload.id}/grant-late-edit/`,
        { granted_until: payload.granted_until, reason: payload.reason },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useRevokeLateEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IWeeklyHarvestPlan> => {
      const { data } = await api.post<IWeeklyHarvestPlan>(
        `/greenhouse/harvest-plans/${id}/revoke-late-edit/`,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useBulkGrantLateEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      plan_ids: number[];
      granted_until: string;
    }): Promise<{ updated: number; results: IWeeklyHarvestPlan[] }> => {
      const { data } = await api.post<{ updated: number; results: IWeeklyHarvestPlan[] }>(
        '/greenhouse/harvest-plans/bulk-grant-late-edit/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
  });
}

export function useBulkRevokeLateEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      plan_ids: number[];
    }): Promise<{ updated: number; results: IWeeklyHarvestPlan[] }> => {
      const { data } = await api.post<{ updated: number; results: IWeeklyHarvestPlan[] }>(
        '/greenhouse/harvest-plans/bulk-revoke-late-edit/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harvest-plans'] });
    },
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
        `/greenhouse/domestic-sales/?${params}`,
      );
      return data;
    },
    staleTime: 60_000,
  });
}
