import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface IMyKpiToday {
  done_count: number;
  avg_duration_seconds: number;
  on_time_rate: number | null;
}

export function useMyKpiToday() {
  return useQuery<IMyKpiToday>({
    queryKey: ['me', 'kpi-today'],
    queryFn: async () => {
      const { data } = await api.get('/me/kpi-today/');
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
