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
      const { data } = await api.get('/me/tasks/');
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
