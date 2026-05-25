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

/**
 * Copy the primitive (scalar) values the server echoed back into a cached row.
 *
 * Skips objects/arrays (firm_splits, block_sources, quality) whose detail-shape
 * differs from the flat sheet/list shape, and skips keys absent from the row so
 * we never introduce detail-only fields. This captures the server side effects
 * the optimistic update cannot predict — an auto-advanced status + its AD-1
 * timestamps, a recomputed total_amount_usd — without a full sheet refetch.
 */
export function mergeServerScalars<T extends object>(row: T, server: Record<string, unknown>): T {
  const next = { ...row } as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!(key in server)) continue;
    const value = server[key];
    if (value === null || typeof value !== 'object') {
      next[key] = value;
    }
  }
  return next as T;
}

/**
 * Reconcile the sheet + list caches with the PATCH response for one shipment.
 *
 * This replaces the per-edit full-sheet refetch: instead of re-downloading the
 * entire un-paginated season, we surgically fold the authoritative scalar
 * values from the response into the single edited row that's already cached.
 */
function reconcileFromServer(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  server: unknown,
): void {
  if (!server || typeof server !== 'object') return;
  const serverObj = server as Record<string, unknown>;

  queryClient.setQueryData<ICachedSheet>(['shipments', 'sheet'], (old) => {
    if (!old || !Array.isArray(old.shipments)) return old;
    return {
      ...old,
      shipments: old.shipments.map((s) => (s.id === id ? mergeServerScalars(s, serverObj) : s)),
    };
  });

  queryClient.setQueriesData<IApiListResponse<IShipmentListItem>>(
    { predicate: (q) => isListQueryKey(q.queryKey) },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        results: old.results.map((s) => (s.id === id ? mergeServerScalars(s, serverObj) : s)),
      };
    },
  );
}

/**
 * Invalidate shipment-related queries WITHOUT touching the heavy, unpaginated
 * `['shipments','sheet']` query — its cache was already reconciled from the
 * PATCH response. Excluding it here is what stops every cell edit from
 * refetching the whole season. Board + list queries are matched (they're
 * inactive on the sheet page, so this only marks them stale — no network).
 */
function invalidateExceptSheet(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'shipments' && q.queryKey[1] !== 'sheet',
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
    onSuccess: (data, { id }) => {
      // Fold server-computed scalars (auto-advanced status, AD-1 timestamps,
      // recomputed totals) into the cached row instead of refetching the sheet.
      reconcileFromServer(queryClient, id, data);
    },
    onError: (err, _vars, context) => {
      rollback(queryClient, context);
      toast.error(extractPatchError(err, t('sheet.save_error')));
      // Always log full error for support: real value, status, response body.
      console.error('[useShipmentPatch] PATCH failed', err);
    },
    onSettled: (_data, _err, { id }) => {
      invalidateExceptSheet(queryClient);
      queryClient.invalidateQueries({ queryKey: ['shipment', String(id)] });
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
    onSuccess: (data, { id }) => {
      reconcileFromServer(queryClient, id, data);
    },
    onError: (err, _vars, context) => {
      rollback(queryClient, context);
      toast.error(extractPatchError(err, t('shipment_edit_drawer.save_error')));
      console.error('[useShipmentPatchMulti] PATCH failed', err);
    },
    onSettled: () => {
      invalidateExceptSheet(queryClient);
      // Detail pages (single-row fetch) are the primary consumer here; refresh
      // any open detail so multi-field drawer edits show through immediately.
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
