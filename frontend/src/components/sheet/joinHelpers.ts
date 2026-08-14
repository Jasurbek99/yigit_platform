// ─── Role codes considered "supply side" ─────────────────────────────────────
export const SUPPLY_ROLES = new Set(['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']);

// ─── Structural shape the classifiers need ───────────────────────────────────
// IShipmentSheetItem and IShipmentDetail satisfy this directly — both declare
// status_code plus required (non-optional) country/customer, so the Sheet and
// the Detail page can pass their shipment objects straight through.
// IShipmentDraft does NOT satisfy it: it has no status_code field at all, and
// its country/customer are optional (`?`) where this interface requires them
// (`number | null`, not `number | null | undefined`). A caller working from a
// raw IShipmentDraft must build a compatible object first, e.g.
// `{ ...draft, status_code: 'draft', country: draft.country ?? null, customer: draft.customer ?? null }`.
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
