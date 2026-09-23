import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_TASK_RULES } from '@/mock/taskRules';
import type { ITaskRule } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

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
      if (USE_MOCK) return MOCK_TASK_RULES;
      const { data } = await api.get<ITaskRule[]>('/export/task-rules/');
      return data;
    },
    staleTime: 5 * 60_000, // rules change on a deploy, not during a shift
  });
}
