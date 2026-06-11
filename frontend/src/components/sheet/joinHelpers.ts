import type { IShipmentSheetItem } from '@/types';

// ─── Role codes considered "supply side" ─────────────────────────────────────
export const SUPPLY_ROLES = new Set(['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']);

// ─── Draft classification helpers ────────────────────────────────────────────

export function isDestinationDraft(s: IShipmentSheetItem): boolean {
  return (
    s.status_code === 'draft' &&
    s.country !== null &&
    s.customer !== null &&
    (s.block_sources == null || s.block_sources.length === 0)
  );
}

export function isSupplyDraft(s: IShipmentSheetItem): boolean {
  return (
    s.status_code === 'draft' &&
    s.block_sources != null &&
    s.block_sources.length > 0 &&
    (s.country === null || SUPPLY_ROLES.has(s.created_by_role ?? ''))
  );
}
