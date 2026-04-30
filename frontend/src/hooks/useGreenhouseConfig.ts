import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  IGreenhouseConfig,
  IOperatingDayException,
  IApiListResponse,
} from '@/types';

const DEFAULT_CONFIG: IGreenhouseConfig = {
  id: 1,
  plan_deadline_weekday: 4,
  plan_late_until_weekday: 6,
  plan_critical_late_at_weekday: 0,
  plan_critical_late_at_time: '00:00:00',
  forecast_primary_open: '17:00:00',
  forecast_primary_close: '18:00:00',
  forecast_fallback_close: '09:00:00',
  forecast_same_day_close: '23:59:00',
  notification_lead_minutes: 60,
  truck_capacity_kg: '18500',
  operating_days_bitmask: 0b0111111,
  timezone_name: 'Asia/Ashgabat',
  updated_by: null,
  updated_by_name: null,
  updated_at: null,
};

export function useGreenhouseConfig() {
  return useQuery({
    queryKey: ['greenhouse-config'],
    queryFn: async (): Promise<IGreenhouseConfig> => {
      const { data } = await api.get<IGreenhouseConfig>('/core/greenhouse-config/');
      return data;
    },
    staleTime: 5 * 60_000,
    // Fall back to default config if endpoint unavailable (e.g. during dev without backend)
    placeholderData: DEFAULT_CONFIG,
  });
}

export function useUpdateGreenhouseConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<IGreenhouseConfig>): Promise<IGreenhouseConfig> => {
      const { data } = await api.patch<IGreenhouseConfig>('/core/greenhouse-config/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['greenhouse-config'] });
    },
  });
}

export function useOperatingDayExceptions(
  filters: { date_from?: string; date_to?: string } = {},
) {
  return useQuery({
    queryKey: ['operating-day-exceptions', filters],
    queryFn: async (): Promise<IOperatingDayException[]> => {
      const params = new URLSearchParams();
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      const { data } = await api.get<IApiListResponse<IOperatingDayException> | IOperatingDayException[]>(
        `/core/operating-day-exceptions/?${params}`,
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpsertOperatingDayException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: Partial<IOperatingDayException> & { date: string },
    ): Promise<IOperatingDayException> => {
      if (payload.id) {
        const { data } = await api.patch<IOperatingDayException>(
          `/core/operating-day-exceptions/${payload.id}/`,
          payload,
        );
        return data;
      }
      const { data } = await api.post<IOperatingDayException>(
        '/core/operating-day-exceptions/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operating-day-exceptions'] });
    },
  });
}

export function useDeleteOperatingDayException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/core/operating-day-exceptions/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operating-day-exceptions'] });
    },
  });
}
