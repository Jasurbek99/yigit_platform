import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface IMyKpiToday {
  done_count: number;
  avg_duration_seconds: number;
  on_time_rate: number | null;
}

export function useMyKpiToday(role?: string | null) {
  return useQuery<IMyKpiToday>({
    // role is part of the key so the tiles always describe the role being
    // viewed on the My tasks page.
    queryKey: ['me', 'kpi-today', role ?? null],
    queryFn: async () => {
      const qs = role ? `?assignee_role=${encodeURIComponent(role)}` : '';
      const { data } = await api.get(`/me/kpi-today/${qs}`);
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
