/**
 * Role blocks for the Sheet.
 *
 * The Sheet is TRANSPOSED: fields are rows, shipments are columns. "Give each
 * role its own block of columns" therefore means a contiguous run of ROWS per
 * owner, with a labelled band row above each run.
 *
 * `IRowConfig.default_who_key` names the specific PERSON who fills a field in
 * today (`sheet.who.sirin`, `sheet.who.gadam`, ...) — it is NOT a role. Several
 * people share one role (document_team = Sirin + Sulgun; transport = Haltac +
 * Mergen + the generic `transport` key), so grouping by the raw who-key
 * fragments one department into several small blocks and labels each with a
 * person's first name instead of their role — both reported as defects
 * (2026-08-24).
 *
 * Role resolution has two tiers, checked in order:
 *   1. `IRowConfig.role_group` — an admin override, set per row in the Sheet
 *      Rows admin tab (`SheetRowSetting.role_group`, backend/views.py `/sheet/`
 *      payload). Lets an admin manage grouping without a code change, and is
 *      the only way to put a custom row into a real block (see below).
 *   2. `WHO_KEY_ROLE` — a static fallback for rows the admin hasn't touched,
 *      seeded from the SAME who-key→role table confirmed with the user
 *      2026-06-02 (`backfill_sheet_row_defaults.WHO_TO_ROLE`, migration
 *      0063_sheet_row_role_group backfills `role_group` from it). Aganazar
 *      maps to `export_manager` here — not `sales_rep` — per that confirmed
 *      decision, even though the one row he owns today (`sales_report_date`)
 *      reads like Sales Rep's; the org-chart decision wins over a single
 *      field's content.
 * Neither present → the row falls back to grouping under its own raw who-key
 * (safe: a not-yet-mapped who-key is still unique to one row today), unless
 * that who-key is itself unownable — see `UNGROUPABLE_WHO_KEYS`.
 *
 * `sheet.who.custom` is the shared fallback for every admin-added custom row
 * (export/views.py) — dozens of physically different rows (e.g. one seen in
 * the wild: "Sirin Resminamalar", "Sirin Transport bolumin resminamalary",
 * "Soltanmyrat Ygylan bolumi") all carry this ONE key. Treating it as a normal
 * group would either wrongly merge unrelated custom rows into one fake block,
 * or — what actually happened — make the SAME key reappear in separate runs
 * across the sheet, fail the owner-contiguity check below, and suppress every
 * band on the whole sheet. `roleGroupKey()` returns `null` for it (and for the
 * empty `sheet.who.none`) UNLESS the row has an explicit `role_group` — an
 * admin can safely put one specific custom row in a block, because that
 * assignment is per-row, not shared the way the who-key is.
 */
import type { IRowConfig } from '@/types';

/** Static who-key -> `ROLE_CHOICES` code, used when a row has no `role_group`
 * override. Keys not listed here (a genuinely new person, or a synthetic key
 * in a test) fall back to grouping under themselves — safe, since a
 * not-yet-mapped who-key is still unique to one row today. Only the
 * explicitly shared/generic keys are excluded outright; see
 * `UNGROUPABLE_WHO_KEYS`. Keep in sync with
 * `backfill_sheet_row_defaults.WHO_TO_ROLE` and migration
 * `0063_sheet_row_role_group`'s backfill table if the org chart changes. */
export const WHO_KEY_ROLE: Record<string, string> = {
  'sheet.who.soltanmyrat': 'loading_dept_head',
  'sheet.who.logist': 'transport',
  'sheet.who.sirin': 'document_team',
  'sheet.who.sulgun': 'document_team',
  'sheet.who.gadam': 'export_manager',
  'sheet.who.haltac': 'transport',
  'sheet.who.malik': 'transport',
  'sheet.who.mergen': 'transport',
  'sheet.who.transport': 'transport',
  'sheet.who.babageldi': 'finansist',
  'sheet.who.arap': 'sales_rep',
  'sheet.who.aganazar': 'export_manager',
};

/** Who-keys that name no single owner and must never be grouped or banded —
 * unless the row carries an explicit `role_group` override (see file header). */
const UNGROUPABLE_WHO_KEYS = new Set(['sheet.who.custom', 'sheet.who.none']);

/**
 * The key rows are grouped and banded by: the row's `role_group` override if
 * set, else its resolved role from `WHO_KEY_ROLE`, else its raw who-key. Only
 * `null` (never grouped) for a shared/generic who-key with no override — see
 * file header.
 */
function roleGroupKey(row: IRowConfig): string | null {
  if (row.role_group) return row.role_group;
  if (UNGROUPABLE_WHO_KEYS.has(row.default_who_key)) return null;
  return WHO_KEY_ROLE[row.default_who_key] ?? row.default_who_key;
}

/** True when `roleGroupKey(row)` resolved to a real `ROLE_CHOICES` code
 * (explicit override or static mapping) rather than a raw who-key
 * self-fallback — decides whether the band label renders `roles.<code>` or
 * the raw key. */
function hasRoleMapping(row: IRowConfig): boolean {
  return !!row.role_group || !!WHO_KEY_ROLE[row.default_who_key];
}

/**
 * Rows kept pinned at the top, in their relative order, and never grouped or
 * banded — the handful an operator needs visible at a glance to know which
 * shipment/destination they're looking at while scrolling through the other
 * 40 fields. This is a field-key set, not a row count: originally (2026-08-24)
 * this was "the first 13 rows", a hardcoded prefix that happened to also pin
 * `vehicle_condition`, `documents_status`, `transport_docs_given_at` and
 * several other role-owned fields along with it — those rows had a `role_group`
 * an admin could set in the Sheet Rows tab that silently did nothing on the
 * Sheet, reported as a defect 2026-08-27. Shrunk the same day to exactly the
 * fields that must stay visible: the shipment identifier plus the four
 * destination fields (owner decision — not `export_code`/`block_sources`/
 * `firm_splits`/`harvest_status`, which now group normally).
 *
 * These are also what the default freeze setting keeps sticky —
 * `DEFAULT_FROZEN_ROW_COUNT` in stores/sheetStore.ts, bumped to 5 the same day
 * (with a storage-key version bump, so every browser picks up the new default
 * rather than keeping a stale 13 from localStorage). The two stay conceptually
 * paired but are read independently — see `pinnedPrefixLength` below.
 */
export const PINNED_FIELD_KEYS: ReadonlySet<string> = new Set([
  'shipment_code',
  'country',
  'customer',
  'city',
  'import_firm',
]);

/**
 * How many rows at the very FRONT of `rows` are pinned. After
 * `groupRowsByOwner`, every pinned-and-present row sits at the front, so this
 * equals however many of `PINNED_FIELD_KEYS` are actually present (fewer than
 * 5 if one is hidden). For any other order — a user's personal row order —
 * it counts however many happen to lead, which can be anywhere from 0 to 5;
 * derived from the actual array, never assumed.
 */
export function pinnedPrefixLength(rows: IRowConfig[]): number {
  let i = 0;
  while (i < rows.length && PINNED_FIELD_KEYS.has(rows[i].field_key)) i += 1;
  return i;
}

/** One band: the role it names (i18n key `roles.<code>`, or a raw who-key
 * fallback for an unmapped owner) and how many rows it covers. */
export interface IRoleBand {
  /** i18n key to render with t() — `roles.transport`, or a raw who-key
   * fallback (`sheet.who.<name>`) when the owner has no role mapping. */
  labelKey: string;
  /** Number of consecutive rows this band heads. */
  rowCount: number;
}

/**
 * Reorder rows so each ROLE's fields sit in one contiguous run. Rows with no
 * resolvable owner (`roleGroupKey` returns null — custom rows, `who.none`)
 * are never moved: each renders exactly where it already sits in the incoming
 * order, so an admin-added custom row's position is never disturbed and it
 * can never end up wedged inside another block.
 *
 * Pinned rows (`PINNED_FIELD_KEYS`) are pulled to the front, in their
 * relative order, ahead of everything else — they are NOT a contiguous
 * prefix in the incoming order (e.g. `block_sources` and `firm_splits`
 * currently sit between `shipment_code` and `country`), so this is a filter,
 * not a slice. Everything else — including fields that used to be pinned by
 * position only — is grouped exactly like any other row.
 *
 * Grouping is stable (rows keep their relative order inside a block) and
 * block order follows first appearance of each role in the incoming order
 * (scanning past the pinned rows), so the diff against the server order
 * stays as small as it can be.
 *
 * This is a VIEW order only. It does not touch `SheetRowSetting.display_order`
 * or `IRowConfig.global_position` (the `#` column), which stay pinned to the
 * admin ordering so staff can still cross-reference the Sheet Rows admin tab.
 * Callers must apply it only when the user has no personal row order — see
 * ShipmentSheet.tsx.
 */
export function groupRowsByOwner(rows: IRowConfig[]): IRowConfig[] {
  const pinned = rows.filter((r) => PINNED_FIELD_KEYS.has(r.field_key));
  const rest = rows.filter((r) => !PINNED_FIELD_KEYS.has(r.field_key));

  const roleBuckets = new Map<string, IRowConfig[]>();
  for (const r of rest) {
    const role = roleGroupKey(r);
    if (role === null) continue;
    const bucket = roleBuckets.get(role);
    if (bucket) bucket.push(r);
    else roleBuckets.set(role, [r]);
  }

  const flushed = new Set<string>();
  const out: IRowConfig[] = [];
  for (const r of rest) {
    const role = roleGroupKey(r);
    if (role === null) {
      out.push(r); // ungroupable: emitted exactly where it already was
      continue;
    }
    if (flushed.has(role)) continue; // this role's block was already flushed
    flushed.add(role);
    out.push(...roleBuckets.get(role)!);
  }

  return [...pinned, ...out];
}

/**
 * Per-row band marks: a band at every index that STARTS a role run at or
 * after `startIndex`, null everywhere else. Rows with no resolvable role
 * (custom rows, `who.none`) are transparent to this whole computation — they
 * neither start/end a run nor count as an owner, so they can sit inside or
 * beside a role's span without affecting it.
 *
 * Two rules make this safe to render against any order the server sends:
 *
 *  1. Indices below `startIndex` are never banded — the pinned rows have no
 *     single owner and are not grouped.
 *  2. If the (role-only) tail is NOT contiguous — some role appears in more
 *     than one run — every mark is null and no bands render at all. A user
 *     who has personally reordered their rows keeps exactly the sheet they
 *     have today instead of a band every other row.
 *
 * `startIndex` is the max of `pinnedPrefixLength(rows)` and the user's frozen
 * row count, because bands are rendered only in the scrollable section — a
 * band must never be swallowed by the sticky frozen band. Defaults to
 * `pinnedPrefixLength(rows)` alone for callers (tests, mostly) that don't
 * care about the live freeze setting.
 */
export function markRoleBands(
  rows: IRowConfig[],
  startIndex: number = pinnedPrefixLength(rows),
): (IRoleBand | null)[] {
  const bands: (IRoleBand | null)[] = rows.map(() => null);
  const from = Math.max(0, startIndex);
  if (from >= rows.length) return bands;

  // Contiguity gate, over ROLES: run count must equal distinct-role count.
  // Rows with no resolvable role are skipped entirely — they can't break a
  // run and can't count as an owner of their own.
  const owners = new Set<string>();
  let runs = 0;
  let prev: string | null = null;
  for (let i = from; i < rows.length; i++) {
    const role = roleGroupKey(rows[i]);
    if (role === null) continue;
    if (role !== prev) {
      runs += 1;
      prev = role;
    }
    owners.add(role);
  }
  if (runs !== owners.size) return bands;

  // rowCount is a count of matching rows, not an index span: an ungroupable
  // row (e.g. a custom row) can sit inside a run's visual range without being
  // a member of it, and must not inflate the badge shown for that role.
  let runStart = -1;
  let runRole: string | null = null;
  let runCount = 0;
  const flush = () => {
    if (runStart !== -1 && runRole !== null) {
      const labelKey = hasRoleMapping(rows[runStart]) ? `roles.${runRole}` : runRole;
      bands[runStart] = { labelKey, rowCount: runCount };
    }
  };
  for (let i = from; i < rows.length; i++) {
    const role = roleGroupKey(rows[i]);
    if (role === null) continue; // ungroupable row: no band, run unaffected
    if (role !== runRole) {
      flush();
      runStart = i;
      runRole = role;
      runCount = 0;
    }
    runCount += 1;
  }
  flush();

  return bands;
}

/** How many band rows are rendered above `index`. Used to correct scroll math. */
export function bandsBefore(bands: (IRoleBand | null)[], index: number): number {
  let count = 0;
  const upto = Math.min(index, bands.length);
  for (let i = 0; i < upto; i++) {
    if (bands[i]) count += 1;
  }
  return count;
}

/**
 * Band height for a given (already zoom-scaled) row height. The ONE definition:
 * SheetGrid uses it both to size the band and to compensate the arrow-key
 * scroll-into-view maths, so the two can never drift at non-100% zoom.
 */
export function bandHeight(rowHeight: number): number {
  return Math.round(rowHeight * 0.62);
}
