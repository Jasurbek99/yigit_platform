import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { IFieldHistoryEntry } from '@/types';

interface IFieldHistoryResult {
  data: IFieldHistoryEntry[];
  isForbidden: boolean;
}

/**
 * Lazy-fetches cell-level edit history for a single shipment field.
 * Only fires when `enabled` is true (pass `enabled: open` so it fetches on first popover open).
 *
 * On 403 → returns { data: [], isForbidden: true } so the popover can render
 * "No history available." without crashing.
 */
export function useFieldHistory(
  shipmentId: number | null,
  fieldKey: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['field-history', shipmentId, fieldKey],
    queryFn: async (): Promise<IFieldHistoryResult> => {
      if (!shipmentId || !fieldKey) return { data: [], isForbidden: false };

      try {
        const { data } = await api.get<{ results: IFieldHistoryEntry[] }>(
          `/export/shipments/${shipmentId}/field-history/?field=${fieldKey}&limit=50`,
        );
        return { data: data.results ?? [], isForbidden: false };
      } catch (err: unknown) {
        // axios error with status 403
        const status = (err as { response?: { status: number } })?.response?.status;
        if (status === 403) {
          return { data: [], isForbidden: true };
        }
        throw err;
      }
    },
    enabled: enabled && !!shipmentId && !!fieldKey,
    staleTime: 0,   // always refetch on re-open so users see latest edits
    retry: false,
  });
}
