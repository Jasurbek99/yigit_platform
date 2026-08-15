// ─── Role codes considered "supply side" ─────────────────────────────────────
export const SUPPLY_ROLES = new Set(['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']);

// ─── Structural shape the classifiers need ───────────────────────────────────
// IShipmentSheetItem and IShipmentDetail satisfy this directly — both declare
// status_code plus required (non-optional) country/customer, so the Sheet and
// the Detail page can pass their shipment objects straight through.
// IShipmentDraft does NOT satisfy it: it has no status_code field at all, and
// it carries no raw country/customer FK ids whatsoever — only
// country_name/customer_name (the backend's ShipmentDraftListSerializer never
// sends the ids). A caller working from a raw IShipmentDraft must supply
// status_code itself and derive country/customer some other way; *_name
// alone isn't enough to build an IJoinClassifiable.
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

// ─── Two-draft join direction ────────────────────────────────────────────────

export type JoinDirection<T extends IJoinClassifiable> =
  | { target: T; source: T }
  | { error: 'ambiguous' };

/**
 * Decide which of two drafts is the destination (target, survives) and which is
 * the supply (source, hard-deleted). A clean pair has exactly one destination
 * (country+customer, no blocks) and one supply (has blocks); anything else is
 * ambiguous. Argument order is irrelevant. A single draft can never be both
 * (blocks length can't be 0 and >0 at once), so no over-match is possible.
 */
export function detectJoinDirection<T extends IJoinClassifiable>(a: T, b: T): JoinDirection<T> {
  if (isDestinationDraft(a) && isSupplyDraft(b)) return { target: a, source: b };
  if (isDestinationDraft(b) && isSupplyDraft(a)) return { target: b, source: a };
  return { error: 'ambiguous' };
}
