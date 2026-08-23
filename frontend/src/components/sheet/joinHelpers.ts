// ─── Who may join two drafts ──────────────────────────────────────
// Mirrors the join endpoint's gate: PRIVILEGED_ROLES {admin, export_manager,
// director} widened with 'boss' at the call site, plus a superuser bypass.
// The Sheet toolbar and the Shipment-list bulk bar MUST use this same list —
// they diverged once and the Sheet's Join button silently vanished for
// admin/boss.
export const JOIN_ROLES: ReadonlyArray<string> = ['admin', 'export_manager', 'director', 'boss'];

export function canUserJoin(user: { role?: string | null; is_superuser?: boolean } | null): boolean {
  if (!user) return false;
  return user.is_superuser === true || JOIN_ROLES.includes(user.role ?? '');
}

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
  // Mirrors the backend gate exactly (export/views.py _validate_join): a draft
  // with at least one block is a valid join SOURCE. The old extra condition
  // (country === null || SUPPLY_ROLES.has(created_by_role)) was a frontend-only
  // rule the API never had — it silently made a blocked-but-destination-filled
  // supply column unjoinable. Dropped. No over-match is possible: a destination
  // needs 0 blocks and a supply needs >0.
  return s.status_code === 'draft' && s.block_sources != null && s.block_sources.length > 0;
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


// ─── Why a selected pair can't be joined ───────────────────────────

/** One unmet join requirement. `key` is an i18n key under `join_blockers`. */
export interface IJoinBlocker {
  key: string;
  code?: string;
}

type Named = IJoinClassifiable & { shipment_code?: string | null };

function label(s: Named): string {
  return s.shipment_code ?? '?';
}

function blockCount(s: IJoinClassifiable): number {
  return s.block_sources?.length ?? 0;
}

/**
 * List the requirements the current selection fails, so the UI can show WHAT
 * to fill instead of a generic "invalid pair". Mirrors the backend's gates in
 * export/views.py `_validate_join`, minus the two the client can't know
 * (season open, caller role) — those still surface as the 400 toast.
 *
 * Returns [] when the pair is joinable.
 */
export function explainJoinBlockers<T extends Named>(selected: T[]): IJoinBlocker[] {
  if (selected.length !== 2) return [{ key: 'need_two' }];

  const [a, b] = selected;
  if (a === b || (a.shipment_code != null && a.shipment_code === b.shipment_code)) {
    return [{ key: 'same_shipment' }];
  }

  const notDrafts = selected.filter((s) => s.status_code !== 'draft');
  if (notDrafts.length > 0) return notDrafts.map((s) => ({ key: 'not_draft', code: label(s) }));

  const withBlocks = selected.filter((s) => blockCount(s) > 0);
  if (withBlocks.length === 2) return [{ key: 'both_supply' }];
  if (withBlocks.length === 0) return [{ key: 'no_supply' }];

  // Exactly one supply → the other column is the destination candidate.
  const target = selected.find((s) => blockCount(s) === 0) as T;
  const blockers: IJoinBlocker[] = [];
  if (target.country === null) blockers.push({ key: 'target_no_country', code: label(target) });
  if (target.customer === null) blockers.push({ key: 'target_no_customer', code: label(target) });
  return blockers;
}
