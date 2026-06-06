// useWorklog — TanStack Query hooks for the worklog REST endpoints.

import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  IWorklogListResponse,
  IWorklogMeResponse,
  IWorklogTeamResponse,
} from '@/types/worklog';

const FIVE_MIN = 5 * 60 * 1000;

export function useMyWorklog() {
  return useQuery({
    queryKey: ['worklog', 'me'],
    queryFn: async () => {
      const { data } = await api.get<IWorklogMeResponse>('/core/worklog/me/');
      return data;
    },
    staleTime: FIVE_MIN,
    refetchInterval: FIVE_MIN,
  });
}

export function useTeamWorklog(date?: string) {
  return useQuery({
    queryKey: ['worklog', 'team', date ?? 'today'],
    queryFn: async () => {
      const { data } = await api.get<IWorklogTeamResponse>('/core/worklog/team/', {
        params: date ? { date } : undefined,
      });
      return data;
    },
    staleTime: FIVE_MIN,
  });
}

export function useUserWorklog(userId: number, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['worklog', 'user', userId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await api.get<IWorklogListResponse>('/core/worklog/', {
        params: {
          user: userId,
          ...(dateFrom ? { from: dateFrom } : {}),
          ...(dateTo ? { to: dateTo } : {}),
        },
      });
      return data;
    },
    staleTime: FIVE_MIN,
    enabled: !!userId,
  });
}
