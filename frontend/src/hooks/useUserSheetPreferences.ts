/**
 * Phase 2a — per-user sheet row preferences: order + hide.
 *
 * Three exports:
 *   useUserSheetPreferences()         GET /export/user/sheet-preferences/
 *   useSaveUserSheetPreferences()     raw PATCH mutation
 *   useDebouncedSaveSheetOrder(ms?)   debounced wrapper for drag/arrow reorder
 *
 * ADR-0003: DB is authoritative. After a successful PATCH the hook invalidates
 * ['user','sheet-preferences'] and ['shipments','sheet'] so the live Sheet
 * picks up the new server-side order without a Zustand store.
 *
 * Phase 2b (IndexedDB + BroadcastChannel) is OUT OF SCOPE here.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import type { IUserSheetPreferences } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const PREFS_QUERY_KEY = ['user', 'sheet-preferences'] as const;
const SHEET_QUERY_KEY = ['shipments', 'sheet'] as const;
const PREFS_ENDPOINT = '/export/user/sheet-preferences/';

// ─── GET hook ─────────────────────────────────────────────────────────────────

/**
 * Fetches the current user's sheet row preferences from the server.
 * Stale time: 60 s — user prefs change rarely; TanStack Query will
 * revalidate automatically after a successful PATCH (via invalidateQueries).
 */
export function useUserSheetPreferences() {
  return useQuery<IUserSheetPreferences>({
    queryKey: PREFS_QUERY_KEY,
    queryFn: async (): Promise<IUserSheetPreferences> => {
      const { data } = await api.get<IUserSheetPreferences>(PREFS_ENDPOINT);
      return data;
    },
    staleTime: 60_000,
    // If the user has never set prefs, the server returns empty arrays.
    // Default to empty so callers can read .row_order safely.
    placeholderData: { row_order: [], hidden_rows: [], updated_at: null },
  });
}

// ─── Raw PATCH mutation ────────────────────────────────────────────────────────

interface ISavePrefsPayload {
  row_order?: number[];
  hidden_rows?: number[];
}

/**
 * Raw PATCH mutation. Both keys are optional; absent key = no-op for that
 * dimension. On success, invalidates both query keys so the Sheet refetches.
 * On 400 with known validation errors, surfaces a translated message.error.
 */
export function useSaveUserSheetPreferences() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  return useMutation<IUserSheetPreferences, unknown, ISavePrefsPayload>({
    mutationFn: async (payload: ISavePrefsPayload): Promise<IUserSheetPreferences> => {
      const { data } = await api.patch<IUserSheetPreferences>(PREFS_ENDPOINT, payload);
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: PREFS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: SHEET_QUERY_KEY }),
      ]);
    },
    onError: (error: unknown) => {
      // Surface known validation errors from the backend
      const responseData = (error as { response?: { data?: { error?: string } } })
        ?.response?.data;
      if (responseData?.error === 'unknown_row_ids') {
        message.error(t('sheet.unknown_row_id_error'));
      } else if (
        typeof responseData?.error === 'string' &&
        responseData.error.includes('duplicate')
      ) {
        message.error(t('sheet.reorder_save_error'));
      } else {
        message.error(t('sheet.reorder_save_error'));
      }
    },
  });
}

// ─── Debounced save wrapper ────────────────────────────────────────────────────

/**
 * Returns a debounced function that coalesces rapid calls into one PATCH.
 * Designed for Up/Down arrow row reorder — the user may click quickly.
 * Default debounce: 500 ms (as specified in master plan §4.2).
 *
 * The returned function is stable across renders (useCallback + ref pattern).
 *
 * Usage:
 *   const saveOrder = useDebouncedSaveSheetOrder();
 *   saveOrder({ row_order: [3, 1, 5, 2, 4] });
 */
export function useDebouncedSaveSheetOrder(debounceMs = 500) {
  const { mutate } = useSaveUserSheetPreferences();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref to the latest payload so the timer captures the newest value.
  const latestPayloadRef = useRef<ISavePrefsPayload | null>(null);

  const debouncedSave = useCallback(
    (payload: ISavePrefsPayload) => {
      latestPayloadRef.current = payload;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (latestPayloadRef.current !== null) {
          mutate(latestPayloadRef.current);
          latestPayloadRef.current = null;
        }
      }, debounceMs);
    },
    [mutate, debounceMs],
  );

  // Cancel any pending PATCH on unmount to avoid stray network calls when the
  // user navigates away within the debounce window.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  return debouncedSave;
}
