// useTeamKpi — TanStack Query hook for the team-KPI leaderboard.

import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { ITeamKpiResponse, TeamKpiPeriod } from '@/types/teamKpi';

const SIXTY_SEC = 60 * 1000;

export function useTeamKpi(period: TeamKpiPeriod) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['team-kpi', period, seasonId],
    queryFn: async () => {
      const { data } = await api.get<ITeamKpiResponse>('/core/team-kpi/', {
        params: { period, ...(seasonId != null ? { season: seasonId } : {}) },
      });
      return data;
    },
    enabled: isReady,
    staleTime: SIXTY_SEC,
    refetchInterval: SIXTY_SEC,
  });
}
