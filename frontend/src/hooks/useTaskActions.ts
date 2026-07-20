import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { getShipmentDetailKey } from './useShipmentDetail';

/**
 * Hook factory that builds a task action mutation.
 * On success, invalidates both the parent shipment query and the global
 * 'my-tasks' query (used by Self Kanban D2).
 */
function useTaskAction(action: 'start' | 'block' | 'unblock' | 'complete') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, reason }: {
      taskId: number;
      shipmentId: number | string;
      reason?: string;
    }) => {
      const body = action === 'block' && reason ? { reason } : undefined;
      const { data } = await api.post(
        `/export/tasks/${taskId}/${action}/`,
        body ?? {},
      );
      return data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(variables.shipmentId) });
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      // Sheet endpoint returns per-shipment task_counts in its wrapped payload
      // — refresh those badge counts after any task state change.
      void queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      // Shipment Board cards show per-shipment task counts + the task modal list
      // — refresh after any task state change so they reflect the new state.
      void queryClient.invalidateQueries({ queryKey: ['shipments', 'board'] });
    },
  });
}

export function useStartTask() {
  return useTaskAction('start');
}

export function useBlockTask() {
  return useTaskAction('block');
}

export function useUnblockTask() {
  return useTaskAction('unblock');
}

export function useCompleteTask() {
  return useTaskAction('complete');
}
