/**
 * Phase 2a — field_key → SheetRowSetting.id mapping.
 *
 * The /sheet/ payload does not currently expose SheetRowSetting.id in the rows[]
 * or row_settings entries (the backend emits field_key as the key, not id).
 * To build the PATCH /user/sheet-preferences/ payload (which requires numeric IDs),
 * we fetch the admin sheet-rows list once and cache it. All authenticated users
 * with shipment.view permission can access this endpoint.
 *
 * This hook is called only when the user interacts with row reorder UI.
 * Stale time: 5 minutes — row IDs are stable (never change after creation).
 */

import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { ISheetRowSetting } from '@/types';

const SHEET_ROW_ID_MAP_KEY = ['sheet', 'row-id-map'] as const;
const ADMIN_ENDPOINT = '/export/admin/sheet-rows/';

interface ISheetRowIdMapResult {
  /** field_key → SheetRowSetting.id */
  byFieldKey: Record<string, number>;
  /** SheetRowSetting.id → field_key */
  byId: Record<number, string>;
  /** Ordered list of { id, field_key } for all active rows, sorted by display_order */
  orderedRows: Array<{ id: number; field_key: string }>;
}

/**
 * Fetches the admin sheet-rows list and builds a bidirectional mapping.
 * Enabled only when `enabled` is true (lazy — don't fetch until needed).
 */
export function useSheetRowIdMap(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;

  return useQuery<ISheetRowIdMapResult>({
    queryKey: SHEET_ROW_ID_MAP_KEY,
    queryFn: async (): Promise<ISheetRowIdMapResult> => {
      const { data } = await api.get<ISheetRowSetting[]>(ADMIN_ENDPOINT);
      const rows = Array.isArray(data) ? data : [];

      const byFieldKey: Record<string, number> = {};
      const byId: Record<number, string> = {};
      const orderedRows: Array<{ id: number; field_key: string }> = [];

      for (const row of rows) {
        if (row.id && row.field_key) {
          byFieldKey[row.field_key] = row.id;
          byId[row.id] = row.field_key;
          orderedRows.push({ id: row.id, field_key: row.field_key });
        }
      }

      return { byFieldKey, byId, orderedRows };
    },
    staleTime: 5 * 60_000, // 5 minutes — row IDs are stable
    enabled,
  });
}
