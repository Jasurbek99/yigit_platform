import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { ITaskRule } from '@/types';

/**
 * The task-generation catalog behind My Tasks.
 * GET /api/v1/export/task-rules/ — a flat array, NOT paginated, lifecycle order.
 *
 * Returns inactive rules too: a deactivated rule is exactly what someone asking
 * "why did this task never appear?" is looking for. The page marks them.
 */
export function useTaskRules() {
  return useQuery({
    queryKey: ['task-rules'],
    queryFn: async (): Promise<ITaskRule[]> => {
      const { data } = await api.get<ITaskRule[]>('/export/task-rules/');
      return data;
    },
    staleTime: 5 * 60_000, // rules change on a deploy, not during a shift
  });
}
