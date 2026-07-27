// useTeamKpi — TanStack Query hook for the team-KPI leaderboard.

import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { ITeamKpiResponse, TeamKpiPeriod } from '@/types/teamKpi';

const SIXTY_SEC = 60 * 1000;

export function useTeamKpi(period: TeamKpiPeriod) {
  return useQuery({
    queryKey: ['team-kpi', period],
    queryFn: async () => {
      const { data } = await api.get<ITeamKpiResponse>('/core/team-kpi/', {
        params: { period },
      });
      return data;
    },
    staleTime: SIXTY_SEC,
    refetchInterval: SIXTY_SEC,
  });
}
