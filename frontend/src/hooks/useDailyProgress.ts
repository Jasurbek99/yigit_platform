import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { IDailyProgress } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/**
 * Plan vs fact for Mon–Sat of a day's ISO week (spec 2026-10-01).
 * Without `date` the server picks its own local today — users sit in KZ/RU,
 * so the browser's day can differ. Counts are JSON ints: no coercion.
 */
export function useDailyProgress(date?: string) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery<IDailyProgress>({
    queryKey: ['daily-progress', date ?? 'today', seasonId],
    queryFn: async () => {
      if (USE_MOCK) return { date: date ?? '', days: [] };
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (seasonId != null) params.set('season', String(seasonId));
      const { data } = await api.get<IDailyProgress>(`/export/truck-allocations/daily-progress/?${params}`);
      return data;
    },
    enabled: USE_MOCK || isReady,
    staleTime: 30_000,
    // Other people open trucks and fill export parts too; poll like the task list.
    refetchInterval: 60_000,
  });
}
