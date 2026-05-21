import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import api from '@/services/api';
import type { IApiListResponse, IShipmentListItem, IShipmentSheetItem } from '@/types';

/**
 * Extract a human-readable error message from an axios error coming back
 * from the Shipment PATCH endpoint. Order of precedence:
 *   1. response.data.error          (our convention for plain string errors)
 *   2. response.data.<field>[0]     (DRF field-level validation errors)
 *   3. response.status + statusText (e.g. "403 Forbidden")
 *   4. error.message                (network / unknown)
 *
 * Returns the supplied i18n fallback string when nothing usable is available.
 */
export function extractPatchError(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<unknown>;
  const data = axiosErr.response?.data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
    // DRF field errors: {"weight_net": ["This field is required."]}
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') {
        return `${key}: ${v[0]}`;
      }
    }
  }
  if (axiosErr.response?.statusText) {
    return `${fallback} (${axiosErr.response.status} ${axiosErr.response.statusText})`;
  }
  if (axiosErr.message) return `${fallback} — ${axiosErr.message}`;
  return fallback;
}

interface IPatchVariables {
  id: number;
  field: string;
  value: unknown;
}

interface IPatchMultiVariables {
  id: number;
  fields: Record<string, unknown>;
}

/**
 * Shape of the cached `['shipments', 'sheet']` value. Mirrors the return type
 * of useShipmentSheet — wrapped object whose `.shipments` field carries the
 * row data. The cache is NOT a flat IShipmentSheetItem[]; the optimistic
 * update has to navigate into `.shipments`. (Pre-Sheet-Control-v2 the cache
 * was a flat array; the wrapper landed in commit 258326f and the optimistic
 * update wasn't migrated, which threw `old?.map is not a function` from
 * onMutate before the PATCH could fire.)
 */
interface ICachedSheet {
  shipments: IShipmentSheetItem[];
  // The cache also holds comment_counts / task_counts / rows / row_settings /
  // last_edits / users_index / current_user_id / current_user_lang / etc.
  // Spread them through unchanged via { ...old } below — no need to type each.
  [extra: string]: unknown;
}

interface IPatchContext {
  previousSheet: ICachedSheet | undefined;
  previousLists: [readonly unknown[], IApiListResponse<IShipmentListItem> | undefined][];
}

const isListQueryKey = (key: readonly unknown[]): boolean =>
  key[0] === 'shipments' && typeof key[1] === 'object' && key[1] !== null;

function applyOptimistic(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  fields: Record<string, unknown>,
): IPatchContext {
  const previousSheet = queryClient.getQueryData<ICachedSheet>(['shipments', 'sheet']);
  queryClient.setQueryData<ICachedSheet>(['shipments', 'sheet'], (old) => {
    if (!old || !Array.isArray(old.shipments)) return old;
    return {
      ...old,
      shipments: old.shipments.map((s) => (s.id === id ? { ...s, ...fields } : s)),
    };
  });

  const previousLists = queryClient.getQueriesData<IApiListResponse<IShipmentListItem>>({
    predicate: (q) => isListQueryKey(q.queryKey),
  });
  queryClient.setQueriesData<IApiListResponse<IShipmentListItem>>(
    { predicate: (q) => isListQueryKey(q.queryKey) },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        results: old.results.map((s) => (s.id === id ? { ...s, ...fields } : s)),
      };
    },
  );

  return { previousSheet, previousLists };
}

function rollback(
  queryClient: ReturnType<typeof useQueryClient>,
  context: IPatchContext | undefined,
): void {
  if (!context) return;
  if (context.previousSheet !== undefined) {
    queryClient.setQueryData(['shipments', 'sheet'], context.previousSheet);
  }
  context.previousLists.forEach(([key, data]) => {
    queryClient.setQueryData(key, data);
  });
}

export function useShipmentPatch() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<unknown, unknown, IPatchVariables, IPatchContext>({
    mutationFn: async ({ id, field, value }) => {
      const { data } = await api.patch(`/export/shipments/${id}/`, { [field]: value });
      return data;
    },
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: ['shipments'] });
      return applyOptimistic(queryClient, id, { [field]: value });
    },
    onError: (err, _vars, context) => {
      rollback(queryClient, context);
      toast.error(extractPatchError(err, t('sheet.save_error')));
      // Always log full error for support: real value, status, response body.
      console.error('[useShipmentPatch] PATCH failed', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}

/**
 * Multi-field PATCH on a single shipment. One request, one optimistic update
 * keyed by id. Used by the web-management Edit Drawer (Detail and List rows).
 */
export function useShipmentPatchMulti() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<unknown, unknown, IPatchMultiVariables, IPatchContext>({
    mutationFn: async ({ id, fields }) => {
      const { data } = await api.patch(`/export/shipments/${id}/`, fields);
      return data;
    },
    onMutate: async ({ id, fields }) => {
      await queryClient.cancelQueries({ queryKey: ['shipments'] });
      return applyOptimistic(queryClient, id, fields);
    },
    onError: (err, _vars, context) => {
      rollback(queryClient, context);
      toast.error(extractPatchError(err, t('shipment_edit_drawer.save_error')));
      console.error('[useShipmentPatchMulti] PATCH failed', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
