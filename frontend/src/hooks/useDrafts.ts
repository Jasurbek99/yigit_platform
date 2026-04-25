import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import api from '@/services/api';
import { MOCK_DRAFTS } from '@/mock/drafts';
import type { IShipmentDraft, IDraftCreatePayload, IDraftAssignPayload } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

// ─── Helpers ──────────────────────────────────────────────────────────────

function sortOldestFirst(drafts: IShipmentDraft[]): IShipmentDraft[] {
  return [...drafts].sort(
    (a, b) => dayjs(a.created_at).valueOf() - dayjs(b.created_at).valueOf(),
  );
}

// ─── useDrafts ────────────────────────────────────────────────────────────

/**
 * Fetches all shipments in DRAFT status, sorted oldest-first.
 * In mock mode returns MOCK_DRAFTS without any API call.
 */
export function useDrafts() {
  return useQuery({
    queryKey: ['drafts'],
    queryFn: async (): Promise<IShipmentDraft[]> => {
      if (USE_MOCK) return sortOldestFirst(MOCK_DRAFTS);

      const { data } = await api.get<{ results: IShipmentDraft[] }>(
        '/export/shipments/?status_code=draft&page_size=200',
      );
      return sortOldestFirst(data.results ?? []);
    },
    staleTime: 30_000,
  });
}

// ─── useCreateDraft ───────────────────────────────────────────────────────

/**
 * Creates a new DRAFT shipment with block_sources.
 * Returns the created IShipmentDraft on success.
 */
export function useCreateDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: IDraftCreatePayload): Promise<IShipmentDraft> => {
      if (USE_MOCK) {
        // No-op in mock mode — optimistically return a stub.
        const stub: IShipmentDraft = {
          id: Date.now(),
          cargo_code: payload.cargo_code,
          date: payload.date,
          created_at: new Date().toISOString(),
          created_by_name: 'Mock User',
          weight_net: payload.block_sources.reduce((s, r) => s + r.weight_kg, 0),
          block_sources: payload.block_sources.map((s) => ({
            block_id: s.block_id,
            block_code: `Block-${s.block_id}`,
            weight_kg: s.weight_kg,
          })),
        };
        return stub;
      }

      const { data } = await api.post<IShipmentDraft>('/export/shipments/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}

// ─── useAssignDraft ───────────────────────────────────────────────────────

interface IAssignDraftArgs {
  draftId: number;
  payload: IDraftAssignPayload;
}

/**
 * Assigns a draft to a destination (triggers draft → yuklenme lifecycle transition).
 * Returns the updated shipment detail.
 */
export function useAssignDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ draftId, payload }: IAssignDraftArgs): Promise<{ id: number }> => {
      if (USE_MOCK) {
        // No-op in mock mode.
        return { id: draftId };
      }

      const { data } = await api.post<{ id: number }>(
        `/export/shipments/${draftId}/assign/`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}
