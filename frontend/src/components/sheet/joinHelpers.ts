// ─── Role codes considered "supply side" ─────────────────────────────────────
export const SUPPLY_ROLES = new Set(['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']);

// ─── Structural shape the classifiers need ───────────────────────────────────
// Minimal enough that IShipmentSheetItem, IShipmentDetail and IShipmentDraft
// (with its FK ids present) all structurally satisfy it — lets the Sheet, the
// Detail page, and the join modal share one classification rule.
export interface IJoinClassifiable {
  status_code: string;
  country: number | null;
  customer: number | null;
  block_sources?: { block_id?: number }[] | null;
  created_by_role?: string | null;
}

// ─── Draft classification helpers ────────────────────────────────────────────

export function isDestinationDraft(s: IJoinClassifiable): boolean {
  return (
    s.status_code === 'draft' &&
    s.country !== null &&
    s.customer !== null &&
    (s.block_sources == null || s.block_sources.length === 0)
  );
}

export function isSupplyDraft(s: IJoinClassifiable): boolean {
  return (
    s.status_code === 'draft' &&
    s.block_sources != null &&
    s.block_sources.length > 0 &&
    (s.country === null || SUPPLY_ROLES.has(s.created_by_role ?? ''))
  );
}
