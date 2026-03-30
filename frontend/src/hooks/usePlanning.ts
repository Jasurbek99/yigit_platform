import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  IApiListResponse,
  IWeeklyHarvestPlan,
  IQuotaDashboardItem,
  IPriceEntry,
  IWeeklyTruckAllocation,
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
