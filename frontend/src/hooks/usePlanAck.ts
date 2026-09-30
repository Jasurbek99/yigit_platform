import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import api from '@/services/api';
import type { ITransportPlan, ITruckAllocationReview } from '@/types';

/** The /export/plan «Tanyşdym» banner data. Not season-scoped: keyed by ISO week. */
export function useTruckAllocationReview(year?: number, week?: number) {
  return useQuery<ITruckAllocationReview>({
    enabled: year != null && week != null,
    queryKey: ['truck-allocation-review', year, week],
    queryFn: async () => {
      const { data } = await api.get(`/export/truck-allocations/review/?year=${year}&week=${week}`);
      return data;
    },
  });
}

/** The /transport/plan page data. All counts are JSON ints — no coercion needed. */
export function useTransportPlan(year: number, week: number) {
  return useQuery<ITransportPlan>({
    queryKey: ['transport-plan', year, week],
    queryFn: async () => {
      const { data } = await api.get(`/export/truck-allocations/transport-plan/?year=${year}&week=${week}`);
      return data;
    },
  });
}

/**
 * «Tanyşdym» — POST /export/tasks/{id}/acknowledge/ with the snapshot of the page
 * the user reviewed. A 409 means the data moved after the page loaded: the page
 * is refetched and the user must look again.
 */
export function useAcknowledgeTask() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['truck-allocation-review'] });
    qc.invalidateQueries({ queryKey: ['transport-plan'] });
    qc.invalidateQueries({ queryKey: ['my-tasks'] });
  };
  return useMutation({
    mutationFn: async ({ taskId, snapshot }: { taskId: number; snapshot: string }) => {
      const { data } = await api.post(`/export/tasks/${taskId}/acknowledge/`, { snapshot });
      return data;
    },
    onSuccess: refresh,
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        toast.warning(t('tasks.ack_stale'));
        refresh();
        return;
      }
      toast.error(t('tasks.ack_failed'));
    },
  });
}
