import { describe, it, expect } from 'vitest';
import type { IRowConfig } from '@/types';
import {
  PINNED_FIELD_KEYS,
  pinnedPrefixLength,
  bandHeight,
  bandsBefore,
  groupRowsByOwner,
  markRoleBands,
} from './sheetRoleBlocks';

/** Number of pinned rows in the real config — kept local so a change to
 * PINNED_FIELD_KEYS shows up here as a diff. */
const PINNED_COUNT = PINNED_FIELD_KEYS.size;

/**
 * The real 45 rows in the order `backend/apps/export/sheet_rows.py` seeds them
 * (field_key → default_who_key). Kept as a literal so a backend reshuffle of
 * DEFAULT_SHEET_ROWS shows up here as a diff rather than silently changing
 * what the grouping produces. Note the 5 pinned fields (shipment_code,
 * country, customer, city, import_firm) are NOT contiguous here — e.g.
 * block_sources/firm_splits sit between shipment_code and country — grouping
 * must pull them together by filtering, not by slicing a prefix.
 */
const SERVER_ORDER: Array<[string, string]> = [
  ['vehicle_condition', 'logist'],
  ['transport_docs_given_at', 'sirin'],
  ['export_manager_note', 'gadam'],
  ['documents_status', 'sirin'],
  ['shipment_code', 'soltanmyrat'],
  ['export_code', 'soltanmyrat'],
  ['block_sources', 'soltanmyrat'],
  ['firm_splits', 'sulgun'],
  ['firm_contracts', 'gadam'],
  ['country', 'gadam'],
  ['customer', 'gadam'],
  ['city', 'arap'],
  ['import_firm', 'gadam'],
  ['harvest_status', 'soltanmyrat'],
  ['vehicle_live_status', 'haltac'],
  ['warehouse_note', 'soltanmyrat'],
  ['document_note', 'sirin'],
  ['loading_started_at', 'soltanmyrat'],
  ['loading_ended_at', 'soltanmyrat'],
  ['departed_at', 'mergen'],
  ['vehicle_responsible', 'transport'],
  ['truck_plate', 'transport'],
  ['has_doc_advance', 'babageldi'],
  ['customs_exit_at', 'sirin'],
  ['transit_days_temp', 'transport'],
  ['driver_name', 'transport'],
  ['driver_phone', 'transport'],
  ['border_point', 'transport'],
  ['border_crossed_at', 'haltac'],
  ['dest_entry_at', 'arap'],
  ['customs_entry_at', 'arap'],
  ['has_peregruz', 'arap'],
  ['peregruz_date', 'arap'],
  ['arrived_at', 'arap'],
  ['rejected_weight_kg', 'soltanmyrat'],
  ['weight_net', 'soltanmyrat'],
  ['packing', 'gadam'],
  ['variety', 'soltanmyrat'],
  ['harvest_date', 'soltanmyrat'],
  ['sale_started_at', 'arap'],
  ['sale_ended_at', 'arap'],
  ['sales_report_date', 'aganazar'],
  ['additional_notes_arap', 'arap'],
  ['customs_clearance_planned_day', 'sirin'],
  ['is_gapy_satys', 'gadam'],
];

function row(fieldKey: string, who: string, index: number): IRowConfig {
  return {
    row_number: index + 1,
    field_key: fieldKey,
    default_who_key: `sheet.who.${who}`,
    label_key: `sheet.row.${fieldKey}`,
    input_type: 'text',
    style: 'base',
    global_position: index + 1,
  };
}

/** The 45 real rows in server order. */
const serverRows: IRowConfig[] = SERVER_ORDER.map(([fk, who], i) => row(fk, who, i));

/** Build an arbitrary row list from owner slugs (index i gets field key `f{i}`).
 * Slugs used in these tests ('a', 'b', 'c', 'x', 'z' ...) are not in
 * `WHO_KEY_ROLE`, so they group and band under themselves — same behaviour
 * the pre-role-mapping code had, which keeps these cases a clean test of the
 * contiguity/ordering mechanics independent of the real name→role table. */
function rowsOf(...owners: string[]): IRowConfig[] {
  return owners.map((who, i) => row(`f${i}`, who, i));
}

/** Pad a tail with the 5 real pinned field keys as a synthetic prefix — same
 * shape as the real config (a fixed field-key set, not a row count), but with
 * a neutral 'ident' owner so who-key content never leaks into these tests. */
function withPinnedPrefix(...tailOwners: string[]): IRowConfig[] {
  const head = [...PINNED_FIELD_KEYS].map((fk, i) => row(fk, 'ident', i));
  const tail = tailOwners.map((who, i) => row(`f${i}`, who, PINNED_COUNT + i));
  return [...head, ...tail];
}

/** Set an admin `role_group` override on a row (mutates a copy, not the original). */
function withRoleGroup(r: IRowConfig, roleGroup: string): IRowConfig {
  return { ...r, role_group: roleGroup };
}

const whoOf = (rows: IRowConfig[]): string[] =>
  rows.map((r) => r.default_who_key.replace('sheet.who.', ''));

describe('pinnedPrefixLength', () => {
  it('counts leading rows whose field_key is pinned, and stops at the first non-pinned one', () => {
    expect(pinnedPrefixLength(withPinnedPrefix('a', 'b'))).toBe(PINNED_COUNT);
    expect(pinnedPrefixLength(rowsOf('a', 'b'))).toBe(0);
    expect(pinnedPrefixLength([])).toBe(0);
  });

  it('is field-key based, not position based — a pinned key later in the array does not count', () => {
    // shipment_code is pinned but sitting at index 1, behind a non-pinned row.
    const rows = [row('vehicle_condition', 'logist', 0), row('shipment_code', 'soltanmyrat', 1)];
    expect(pinnedPrefixLength(rows)).toBe(0);
  });
});

describe('groupRowsByOwner', () => {
  it('pulls the 5 pinned fields to the front, in their relative order, even though they are scattered in the source', () => {
    const grouped = groupRowsByOwner(serverRows);
    // In SERVER_ORDER these are NOT adjacent (block_sources/firm_splits sit
    // between shipment_code and country) — grouping must filter, not slice.
    expect(grouped.slice(0, PINNED_COUNT).map((r) => r.field_key)).toEqual([
      'shipment_code',
      'country',
      'customer',
      'city',
      'import_firm',
    ]);
  });

  it('releases fields that used to be pinned by position only into their role block', () => {
    // vehicle_condition, documents_status, transport_docs_given_at etc. sat
    // in the old 13-row positional prefix but were never meant to stay fixed
    // — reported as a defect (2026-08-27) once their Role Block setting in
    // the admin tab turned out to be a structural no-op. They must now
    // appear somewhere in the grouped tail, not in the pinned front.
    const grouped = groupRowsByOwner(serverRows);
    const pinnedKeys = new Set(grouped.slice(0, PINNED_COUNT).map((r) => r.field_key));
    for (const fk of ['vehicle_condition', 'documents_status', 'transport_docs_given_at', 'export_code', 'block_sources', 'firm_splits', 'harvest_status']) {
      expect(pinnedKeys.has(fk)).toBe(false);
      expect(grouped.some((r) => r.field_key === fk)).toBe(true);
    }
  });

  it('merges every who-key sharing a role into one contiguous run', () => {
    const grouped = groupRowsByOwner(serverRows);
    expect(grouped).toHaveLength(serverRows.length);
    expect(new Set(grouped.map((r) => r.field_key)).size).toBe(serverRows.length);

    // logist + haltac + mergen + the generic "transport" who-key are all
    // `transport` (vehicle_condition used to be pinned and hid this). gadam +
    // aganazar are both `export_manager` (the confirmed 2026-06-02 org-chart
    // mapping — Aganazar's one row reads like Sales Rep content, but the
    // confirmed role wins).
    const tailWho = whoOf(grouped.slice(PINNED_COUNT));
    const transportIdx = ['logist', 'haltac', 'mergen', 'transport'].map((w) => tailWho.indexOf(w));
    const transportSpan = tailWho.slice(Math.min(...transportIdx), Math.max(...transportIdx) + 1);
    expect(transportSpan.every((w) => ['logist', 'haltac', 'mergen', 'transport'].includes(w))).toBe(true);

    const exportMgrIdx = [tailWho.indexOf('gadam'), tailWho.indexOf('aganazar')];
    const exportMgrSpan = tailWho.slice(Math.min(...exportMgrIdx), Math.max(...exportMgrIdx) + 1);
    expect(exportMgrSpan.every((w) => ['gadam', 'aganazar'].includes(w))).toBe(true);
  });

  it('orders role blocks by first appearance (past the pinned fields) and is stable inside a block', () => {
    const grouped = groupRowsByOwner(serverRows);
    // Stability: soltanmyrat's (loading_dept_head) rows keep their server-relative
    // order, now including export_code/block_sources/harvest_status — released
    // from the old positional prefix.
    expect(
      grouped
        .slice(PINNED_COUNT)
        .filter((r) => r.default_who_key === 'sheet.who.soltanmyrat')
        .map((r) => r.field_key),
    ).toEqual([
      'export_code',
      'block_sources',
      'harvest_status',
      'warehouse_note',
      'loading_started_at',
      'loading_ended_at',
      'rejected_weight_kg',
      'weight_net',
      'variety',
      'harvest_date',
    ]);
  });

  it('lets a custom row sit between two rows of the same role without blocking their merge', () => {
    // An admin-added custom row (shared generic `sheet.who.custom` key) sits
    // between two `gadam` (export_manager) rows — the shape reported in the
    // wild (2026-08-24): a custom row wedged inside what would otherwise be
    // one contiguous role run. The custom row is never adopted into a role
    // bucket, but it also must not stop the two real rows from merging.
    const rows = withPinnedPrefix('gadam', 'custom', 'gadam', 'sirin');
    const grouped = groupRowsByOwner(rows);
    expect(new Set(grouped.map((r) => r.field_key))).toEqual(new Set(rows.map((r) => r.field_key)));

    const tailWho = whoOf(grouped.slice(PINNED_COUNT));
    // Both gadam rows are now adjacent...
    const gadamIdx = [tailWho.indexOf('gadam'), tailWho.lastIndexOf('gadam')];
    expect(gadamIdx[1] - gadamIdx[0]).toBe(1);
    // ...and the custom row still exists, un-merged, elsewhere in the tail.
    expect(tailWho.filter((w) => w === 'custom')).toHaveLength(1);
  });

  it('groups a short list with no pinned rows just like any other tail — no special-casing on length', () => {
    const short = rowsOf('a', 'b', 'a');
    expect(groupRowsByOwner(short).map((r) => r.field_key)).toEqual(['f0', 'f2', 'f1']);
    expect(groupRowsByOwner([])).toEqual([]);
  });

  it('an explicit role_group override wins over the static WHO_KEY_ROLE mapping', () => {
    // 'gadam' normally maps to export_manager. An admin reassigning that one
    // row's role_group to 'transport' must pull it into the transport block
    // instead — the whole point of the admin override.
    const base = withPinnedPrefix('haltac', 'gadam', 'transport');
    const rows = base.map((r) => (r.default_who_key === 'sheet.who.gadam' ? withRoleGroup(r, 'transport') : r));
    const grouped = groupRowsByOwner(rows);
    const tailWho = whoOf(grouped.slice(PINNED_COUNT));
    expect(tailWho).toEqual(['haltac', 'gadam', 'transport']); // all one contiguous run
  });

  it('an explicit role_group lets an otherwise-ungroupable custom row join a real block', () => {
    // Without an override, a `sheet.who.custom` row is transparent (never
    // grouped) — see the file header. An admin CAN choose to group one
    // specific custom row by assigning it a role_group; this is safe because
    // the assignment is per-row, unlike the shared who-key.
    const base = withPinnedPrefix('sirin', 'custom', 'sirin');
    const rows = base.map((r) =>
      r.default_who_key === 'sheet.who.custom' ? withRoleGroup(r, 'document_team') : r,
    );
    const grouped = groupRowsByOwner(rows);
    const tailWho = whoOf(grouped.slice(PINNED_COUNT));
    expect(tailWho.filter((w) => w === 'custom')).toHaveLength(1);
    // The custom row now sits inside the merged document_team run, not off to the side.
    const bands = markRoleBands(grouped);
    expect(bands[PINNED_COUNT]).toEqual({ labelKey: 'roles.document_team', rowCount: 3 });
  });
});

describe('markRoleBands', () => {
  it('produces no bands for an empty list', () => {
    expect(markRoleBands([])).toEqual([]);
  });

  it('never bands the pinned prefix, regardless of what the tail owners do', () => {
    const rows = withPinnedPrefix('x', 'x');
    expect(markRoleBands(rows).slice(0, PINNED_COUNT).every((b) => b === null)).toBe(true);
  });

  it('emits one band per role run, with the run length', () => {
    const bands = markRoleBands(withPinnedPrefix('a', 'a', 'a', 'b', 'c', 'c'));
    expect(bands[PINNED_COUNT]).toEqual({ labelKey: 'sheet.who.a', rowCount: 3 });
    expect(bands[PINNED_COUNT + 3]).toEqual({ labelKey: 'sheet.who.b', rowCount: 1 });
    expect(bands[PINNED_COUNT + 4]).toEqual({ labelKey: 'sheet.who.c', rowCount: 2 });
    expect(bands.filter(Boolean)).toHaveLength(3);
  });

  it('labels a mapped role as `roles.<code>`, not the person who-key', () => {
    const rows = withPinnedPrefix('haltac', 'mergen', 'transport');
    const bands = markRoleBands(rows);
    expect(bands[PINNED_COUNT]).toEqual({ labelKey: 'roles.transport', rowCount: 3 });
  });

  it('suppresses ALL bands when the tail is not role-contiguous', () => {
    // A user who personally reordered can produce a,b,a. Rather than banding
    // "a" twice (or every other row), the sheet renders as it does today.
    const bands = markRoleBands(withPinnedPrefix('a', 'b', 'a'));
    expect(bands.every((b) => b === null)).toBe(true);
  });

  it('does not let a scattered custom row suppress bands for the real rows around it', () => {
    // Real defect (2026-08-24): several admin-added custom rows, all sharing
    // `sheet.who.custom`, landed in separate runs and tripped the "same owner
    // in two places" gate — killing every band on the whole sheet, even
    // though the named rows around them were perfectly role-contiguous. Feed
    // this test the GROUPED order directly (as SheetGrid does), since a
    // custom row's raw position can shift when a same-role row merges past
    // it — `groupRowsByOwner` covers that separately above.
    const grouped = groupRowsByOwner(withPinnedPrefix('gadam', 'custom', 'gadam', 'sirin'));
    const bands = markRoleBands(grouped);
    expect(bands.some(Boolean)).toBe(true);
    expect(bands[PINNED_COUNT]).toEqual({ labelKey: 'roles.export_manager', rowCount: 2 });
    // Nothing double-counts the custom row sitting inside that visual span.
    expect(bands[PINNED_COUNT + 1]).toBeNull();
    expect(bands[PINNED_COUNT + 3]).toEqual({ labelKey: 'roles.document_team', rowCount: 1 });
  });

  it('starts at the caller-supplied index so a band is never hidden under the frozen band', () => {
    const rows = withPinnedPrefix('a', 'a', 'b', 'b');
    const bands = markRoleBands(rows, PINNED_COUNT + 1);
    expect(bands[PINNED_COUNT]).toBeNull();
    // The first scrollable row always starts a band, even mid-run.
    expect(bands[PINNED_COUNT + 1]).toEqual({ labelKey: 'sheet.who.a', rowCount: 1 });
    expect(bands[PINNED_COUNT + 2]).toEqual({ labelKey: 'sheet.who.b', rowCount: 2 });
  });

  it('returns all-null when startIndex is at or past the end', () => {
    const rows = withPinnedPrefix('a', 'a');
    expect(markRoleBands(rows, rows.length).every((b) => b === null)).toBe(true);
  });

  it('defaults startIndex to pinnedPrefixLength when the caller omits it', () => {
    const rows = withPinnedPrefix('a', 'a');
    expect(markRoleBands(rows)).toEqual(markRoleBands(rows, PINNED_COUNT));
  });

  it('bands the grouped real rows into exactly 6 role blocks, in first-appearance order', () => {
    // 9 people, but several share a role: transport, document_team,
    // export_manager, loading_dept_head, finansist, sales_rep. transport is
    // first now because vehicle_condition (logist) — previously pinned by
    // position — is the very first released row.
    const bands = markRoleBands(groupRowsByOwner(serverRows)).filter(Boolean);
    expect(bands).toHaveLength(6);
    expect(bands.map((b) => b!.labelKey)).toEqual([
      'roles.transport',
      'roles.document_team',
      'roles.export_manager',
      'roles.loading_dept_head',
      'roles.finansist',
      'roles.sales_rep',
    ]);
    expect(bands.map((b) => b!.rowCount)).toEqual([10, 6, 5, 10, 1, 8]);
    expect(bands.reduce((sum, b) => sum + b!.rowCount, 0)).toBe(serverRows.length - PINNED_COUNT);
    // Same 45 rows in the raw server order are not role-contiguous → no bands.
    expect(markRoleBands(serverRows).every((b) => b === null)).toBe(true);
  });
});

describe('bandsBefore', () => {
  it('counts only the bands rendered above the index', () => {
    const bands = markRoleBands(groupRowsByOwner(serverRows));
    expect(bandsBefore(bands, 0)).toBe(0);
    expect(bandsBefore(bands, PINNED_COUNT)).toBe(0);
    expect(bandsBefore(bands, PINNED_COUNT + 1)).toBe(1);
    expect(bandsBefore(bands, bands.length)).toBe(6);
  });

  it('clamps an index past the end', () => {
    const bands = markRoleBands(groupRowsByOwner(serverRows));
    expect(bandsBefore(bands, 9999)).toBe(6);
  });
});

describe('bandHeight', () => {
  it('scales with the row height so bands and rows stay in step at any zoom', () => {
    expect(bandHeight(36)).toBe(22);
    expect(bandHeight(54)).toBe(33);
    expect(bandHeight(22)).toBe(14);
  });
});
