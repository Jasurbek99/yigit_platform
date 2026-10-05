import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_RULE_CANDIDATES, MOCK_TASK_RULES } from '@/mock/taskRules';
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

export interface ITaskRuleCandidate {
  id: number;
  full_name: string;
  role: string;
}

/** Users who may be assigned to a rule. Only fetched while the editor is open. */
export function useTaskRuleCandidates(ruleId: number | null) {
  return useQuery({
    queryKey: ['task-rule-candidates', ruleId],
    enabled: ruleId != null,
    queryFn: async (): Promise<ITaskRuleCandidate[]> => {
      if (USE_MOCK) return MOCK_RULE_CANDIDATES;
      const { data } = await api.get<ITaskRuleCandidate[]>(
        `/export/task-rules/${ruleId}/assignee-candidates/`,
      );
      return data;
    },
  });
}

export function useSetTaskRuleAssignees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ruleId, userIds }: { ruleId: number; userIds: number[] }) => {
      if (USE_MOCK) {
        const rule = MOCK_TASK_RULES.find((r) => r.id === ruleId) ?? MOCK_TASK_RULES[0];
        return { ...rule, assignees: MOCK_RULE_CANDIDATES.filter((c) => userIds.includes(c.id)) };
      }
      const { data } = await api.put<ITaskRule>(
        `/export/task-rules/${ruleId}/assignees/`, { user_ids: userIds },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-rules'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
