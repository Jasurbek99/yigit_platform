import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import api from '@/services/api';
import type { ISheetRowSetting } from '@/types';

const QUERY_KEY = ['admin', 'sheet-rows'] as const;

// ─── Fetch ────────────────────────────────────────────────────────────────────

export function useSheetRowSettings() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<ISheetRowSetting[]> => {
      const { data } = await api.get<ISheetRowSetting[]>('/export/admin/sheet-rows/');
      // Backend returns a plain array (not paginated). Guard just in case.
      const rows = Array.isArray(data) ? data : (data as { results: ISheetRowSetting[] }).results;
      return [...rows].sort((a, b) => a.display_order - b.display_order);
    },
    staleTime: 60_000,
  });
}

// ─── Save (PATCH with optimistic version check) ───────────────────────────────

export interface IVersionConflictError {
  error: 'version_conflict';
  current_version: number;
}

export interface ISaveSheetRowPayload {
  id: number;
  version: number;
  label_tk?: string;
  label_ru?: string;
  label_en?: string;
  // Phase 5a: per-row "Who" override (Col B), 3 langs.
  who_tk?: string;
  who_ru?: string;
  who_en?: string;
  description_tk?: string;
  description_ru?: string;
  description_en?: string;
  is_visible?: boolean;
  is_locked?: boolean;
  style_width?: number | null;
  style_align?: 'left' | 'center' | 'right' | null;
  style_color?: string | null;
  style_font_color?: string | null;
  style_font_weight?: 'bold' | 'normal' | '';
  style_font_style?: 'normal' | 'italic' | '';
  style_font_family?: 'dm_sans' | 'inter' | 'mono' | 'serif' | '';
  style_font_size?: number | null;
  triggered_user?: number | null;
  /** Send as triggered_roles_write — backend's write-only alias. */
  triggered_roles?: string[];
}

export function useSaveSheetRowSetting() {
  const queryClient = useQueryClient();

  return useMutation<ISheetRowSetting, AxiosError<IVersionConflictError>, ISaveSheetRowPayload>({
    mutationFn: async ({ id, triggered_roles, ...rest }) => {
      const body: Record<string, unknown> = { ...rest };
      // Backend's write field for roles is triggered_roles_write (write-only alias)
      if (triggered_roles !== undefined) {
        body.triggered_roles_write = triggered_roles;
      }
      const { data } = await api.patch<ISheetRowSetting>(
        `/export/admin/sheet-rows/${id}/`,
        body,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // Also invalidate the live sheet so lock/label changes are visible immediately
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}

// ─── Reorder ──────────────────────────────────────────────────────────────────

export function useReorderSheetRows() {
  const queryClient = useQueryClient();

  return useMutation<{ reordered: number }, AxiosError, { order: number[] }>({
    mutationFn: async ({ order }) => {
      const { data } = await api.post<{ reordered: number }>(
        '/export/admin/sheet-rows/reorder/',
        { order },
      );
      return data;
    },
    onMutate: async ({ order }) => {
      // Optimistic update: reorder the cached list immediately
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<ISheetRowSetting[]>(QUERY_KEY);

      if (previous) {
        const byId: Record<number, ISheetRowSetting> = {};
        for (const row of previous) byId[row.id] = row;
        const reordered = order
          .map((id, idx) => {
            const row = byId[id];
            if (!row) return null;
            return { ...row, display_order: (idx + 1) * 1024 };
          })
          .filter((r): r is ISheetRowSetting => r !== null);

        // Rows not in the order list keep their place at the end
        const inOrder = new Set(order);
        const remaining = previous
          .filter((r) => !inOrder.has(r.id))
          .sort((a, b) => a.display_order - b.display_order);

        queryClient.setQueryData<ISheetRowSetting[]>(QUERY_KEY, [...reordered, ...remaining]);
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: ISheetRowSetting[] } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(QUERY_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// ─── Bulk permissions ─────────────────────────────────────────────────────────

export interface IBulkPermissionsPayload {
  row_id: number;
  grants: number[];
  revokes: number[];
}

export function useBulkPermissions() {
  const queryClient = useQueryClient();

  return useMutation<{ granted: number; revoked: number }, AxiosError, IBulkPermissionsPayload>({
    mutationFn: async (payload) => {
      const { data } = await api.post<{ granted: number; revoked: number }>(
        '/export/admin/sheet-rows/permissions/bulk/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// ─── Soft-delete ──────────────────────────────────────────────────────────────

export function useSoftDeleteSheetRow() {
  const queryClient = useQueryClient();

  return useMutation<void, AxiosError<{ error: string }>, { id: number }>({
    mutationFn: async ({ id }) => {
      await api.delete(`/export/admin/sheet-rows/${id}/`);
    },
    onSuccess: () => {
      // Invalidate both the admin row list AND the live Sheet payload, so a
      // deleted row vanishes from open Sheet tabs without a manual refresh.
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export function useRestoreSheetRow() {
  const queryClient = useQueryClient();

  return useMutation<ISheetRowSetting, AxiosError, { id: number }>({
    mutationFn: async ({ id }) => {
      const { data } = await api.post<ISheetRowSetting>(
        `/export/admin/sheet-rows/${id}/restore/`,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// ─── Phase 5c: create custom row ──────────────────────────────────────────

export interface ICreateCustomRowPayload {
  field_key: string;          // Must start with 'custom_'
  label_en: string;
  label_ru?: string;
  label_tk?: string;
  who_en?: string;
  who_ru?: string;
  who_tk?: string;
}

/**
 * POST /export/admin/sheet-rows/ — admin-creates a free-text custom row.
 * Backend rejects field_keys not starting with `custom_`, duplicates, and
 * requests with all empty labels. On success, invalidates the admin row
 * list AND the sheet payload so the new row appears in the Sheet without
 * a manual refresh.
 */
export function useCreateCustomSheetRow() {
  const queryClient = useQueryClient();
  return useMutation<ISheetRowSetting, AxiosError<{ error: string }>, ICreateCustomRowPayload>({
    mutationFn: async (payload) => {
      const { data } = await api.post<ISheetRowSetting>('/export/admin/sheet-rows/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}
