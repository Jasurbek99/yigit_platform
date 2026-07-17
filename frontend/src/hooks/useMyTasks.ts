import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { ITaskListItem } from '@/types';

export interface IMyTasksResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: ITaskListItem[];
}

export function useMyTasks(
  options: { enabled?: boolean; role?: string | null } = {},
) {
  const { enabled, role = null } = options;
  return useQuery<IMyTasksResponse>({
    enabled: enabled ?? true,
    // role is part of the key: without it, switching roles would render the
    // previous role's cached tasks under the new role's name.
    queryKey: ['my-tasks', role],
    queryFn: async () => {
      // page_size=1000: the My tasks page renders ALL tasks (active +
      // done-today + history) from this single fetch, so the cap must clear a
      // role's full per-season backlog or the newest tasks silently drop off.
      // Backed by TaskBoardPagination (max 2000) on /me/tasks/.
      //
      // A supervisor with NO role selected still exceeds this cap (1270 tasks
      // across all roles as of 2026-07) — that truncation is pre-existing.
      // Selecting a role is what makes the view complete: the largest single
      // role is ~574.
      const params = new URLSearchParams({ page_size: '1000' });
      if (role) params.set('assignee_role', role);
      const { data } = await api.get(`/me/tasks/?${params.toString()}`);
      return data;
    },
    // Polls app-wide (AppLayout nav badge). 60s halves the steady-state
    // request rate vs 30s; the interval auto-pauses while the tab is
    // backgrounded (refetchIntervalInBackground defaults to false in v5).
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
