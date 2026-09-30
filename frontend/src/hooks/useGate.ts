import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IGateBoard, IGateRow } from '@/types';

export type GateAction = 'arrive' | 'depart' | 'undo_arrive' | 'undo_depart';

/** Non-guards (admin, boss) must name the gate; a guard's own is server-side. */
function locationQuery(locationId: number | null): string {
  return locationId == null ? '' : `?location=${locationId}`;
}

function request(action: GateAction): { path: string; body: Record<string, string> } {
  if (action === 'undo_arrive') return { path: 'undo', body: { event: 'arrive' } };
  if (action === 'undo_depart') return { path: 'undo', body: { event: 'depart' } };
  return { path: action, body: {} };
}

/** The `{"error": "<code>"}` code of a failed gate call, or null. */
export function gateErrorCode(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const code = (error.response?.data as { error?: unknown } | undefined)?.error;
  return typeof code === 'string' ? code : null;
}

export function useGateBoard(locationId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['gate-board', locationId],
    queryFn: async (): Promise<IGateBoard> => {
      const { data } = await api.get<IGateBoard>(`/export/gate/${locationQuery(locationId)}`);
      return data;
    },
    enabled,
    refetchInterval: 60_000,
    // A real gate error (bad request/permission) is final — don't retry it.
    // A transient failure (network blip) gets two retries before the poll is
    // treated as failed, so a flaky connection doesn't blank the list on one
    // dropped request (final-fix review F11).
    retry: (count, error) => gateErrorCode(error) == null && count < 2,
  });
}

export function useGateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, locationId }: {
      id: number; action: GateAction; locationId: number | null;
    }): Promise<IGateRow> => {
      const { path, body } = request(action);
      const { data } = await api.post<IGateRow>(
        `/export/gate/${id}/${path}/${locationQuery(locationId)}`, body,
      );
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['gate-board'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
