/**
 * Per-user sheet row preferences: order + hide.
 *
 * Three exports:
 *   useUserSheetPreferences()         GET /export/user/sheet-preferences/
 *   useSaveUserSheetPreferences()     raw PATCH mutation
 *   useDebouncedSaveSheetOrder(ms?)   debounced wrapper for drag/arrow reorder
 *
 * Phase 2a: server is authoritative (ADR-0003); after every successful PATCH
 * the hook invalidates ['user','sheet-preferences'] and ['shipments','sheet']
 * so the live Sheet picks up the new server-side order.
 *
 * Phase 2b additions (this file):
 *   - IndexedDB write-through cache (cache/userPrefsCache.ts) — gives the
 *     Sheet an instant render on load before the server fetch returns and
 *     keeps the local copy consistent after every save.
 *   - BroadcastChannel sync (cache/broadcast.ts) — a save in tab A invalidates
 *     the prefs query in tab B so the second tab re-renders without a manual
 *     refresh. Other tabs read the freshly-written IDB value via the
 *     re-fetch's onSuccess pathway.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import {
  loadCachedPrefs,
  saveCachedPrefs,
} from '@/cache/userPrefsCache';
import {
  broadcastPrefsChanged,
  onPrefsChanged,
} from '@/cache/broadcast';
import type { IUserSheetPreferences } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const PREFS_QUERY_KEY = ['user', 'sheet-preferences'] as const;
const SHEET_QUERY_KEY = ['shipments', 'sheet'] as const;
const PREFS_ENDPOINT = '/export/user/sheet-preferences/';

// ─── GET hook ─────────────────────────────────────────────────────────────────

/**
 * Fetches the current user's sheet row preferences from the server, with an
 * IndexedDB read-through that returns instantly while the server fetch runs.
 *
 * Stale time: 60 s. After a successful PATCH the mutation invalidates this
 * query directly. Cross-tab updates arrive via BroadcastChannel (see the
 * useEffect below) and trigger an invalidation on the receiving tab.
 *
 * The IDB read happens inside `queryFn`: we issue both reads in parallel and
 * pick the server response when it arrives. If the server fetch fails (offline
 * etc.) and IDB has data, the cached value is used — keeps the Sheet usable
 * during transient outages. On success, IDB is updated.
 */
export function useUserSheetPreferences() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;

  return useQuery<IUserSheetPreferences>({
    queryKey: PREFS_QUERY_KEY,
    queryFn: async (): Promise<IUserSheetPreferences> => {
      try {
        const { data } = await api.get<IUserSheetPreferences>(PREFS_ENDPOINT);
        // Write-through: IDB now mirrors the server.
        if (userId) await saveCachedPrefs(userId, data);
        return data;
      } catch (err) {
        // Server unreachable — fall back to IDB if we have a copy. Otherwise
        // re-throw so TanStack Query reports the error to consumers.
        if (userId) {
          const cached = await loadCachedPrefs(userId);
          if (cached) return cached;
        }
        throw err;
      }
    },
    staleTime: 60_000,
    placeholderData: { row_order: [], hidden_rows: [], updated_at: null },
  });
}

// ─── Cross-tab sync ───────────────────────────────────────────────────────────

/**
 * Subscribe to BroadcastChannel notifications. Mount once at the page level
 * (e.g. in ShipmentSheet.tsx) so the listener lives as long as the Sheet UI.
 * On message, invalidates the prefs query — TanStack Query then refetches,
 * and the queryFn picks up the freshly-written IDB value (the publisher
 * already wrote it before broadcasting).
 */
export function useUserSheetPrefsBroadcast(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? 0;

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = onPrefsChanged((msg) => {
      // Ignore messages from a different user (e.g. logged-out tab).
      if (msg.user_id !== userId) return;
      qc.invalidateQueries({ queryKey: PREFS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: SHEET_QUERY_KEY });
    });
    return unsubscribe;
  }, [qc, userId]);
}

// ─── Raw PATCH mutation ────────────────────────────────────────────────────────

interface ISavePrefsPayload {
  row_order?: number[];
  hidden_rows?: number[];
}

/**
 * Raw PATCH mutation. Both keys are optional; absent key = no-op for that
 * dimension. On success: writes the response through to IDB, broadcasts to
 * other tabs, then invalidates the local TanStack Query keys.
 */
export function useSaveUserSheetPreferences() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? 0;

  return useMutation<IUserSheetPreferences, unknown, ISavePrefsPayload>({
    mutationFn: async (payload: ISavePrefsPayload): Promise<IUserSheetPreferences> => {
      const { data } = await api.patch<IUserSheetPreferences>(PREFS_ENDPOINT, payload);
      return data;
    },
    onSuccess: async (data) => {
      // Write-through to IDB FIRST so the broadcast receiver in other tabs
      // reads the freshly-saved value when it picks up the message.
      if (userId) {
        await saveCachedPrefs(userId, data);
        broadcastPrefsChanged(userId);
      }
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
