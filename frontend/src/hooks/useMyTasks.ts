import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { ITaskListItem } from '@/types';

export interface IMyTasksResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: ITaskListItem[];
}

export function useMyTasks(options: { enabled?: boolean } = {}) {
  return useQuery<IMyTasksResponse>({
    enabled: options.enabled ?? true,
    queryKey: ['my-tasks'],
    queryFn: async () => {
      // page_size=1000: the SelfBoard renders ALL of a user's tasks (active +
      // done-today + history) from this single fetch, so the cap must clear a
      // role's full per-season backlog or the newest tasks silently drop off.
      // Backed by TaskBoardPagination (max 2000) on /me/tasks/.
      const { data } = await api.get('/me/tasks/?page_size=1000');
      return data;
    },
    // Polls app-wide (AppLayout nav badge). 60s halves the steady-state
    // request rate vs 30s; the interval auto-pauses while the tab is
    // backgrounded (refetchIntervalInBackground defaults to false in v5).
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
