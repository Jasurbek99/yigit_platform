/**
 * Topic order for the Sheet's iOS design variant.
 *
 * The classic Sheet orders rows by OWNER — a contiguous run per person/role
 * with a role band above it (`sheetRoleBlocks.ts`). The Sera Bütçe app's
 * "Tır Takip → Tırlar" screen, which the iOS variant reproduces, orders the
 * same kind of transposed grid by TOPIC instead: identity, cargo & customs,
 * transport, loading times, road & border, sales & report.
 *
 * Those two groupings are mutually exclusive. A topic order interleaves owners,
 * which trips the owner-contiguity gate in `markRoleBands` and would silently
 * suppress every role band — so this module produces its own bands (in the same
 * `IRoleBand` shape, so `SheetRoleBandRow` renders them unchanged) and the grid
 * uses these INSTEAD of the role bands while the iOS variant is on.
 *
 * Scope, deliberately: this is a display-time reorder only. It never writes to
 * `UserSheetRowPref` and never touches the classic order. Because the grid's
 * per-row up/down control persists whatever order it is looking at, that
 * control is disabled in this variant (see `SheetGrid`) — otherwise nudging one
 * row would save the whole topic order as the user's personal order.
 *
 * Ordering rule INSIDE a section: follow the reference screen's sequence exactly
 * for the fields it has, and place a YGT-only field next to its nearest sibling
 * there (`customs_entry_at` after `dest_entry_at`, `rejected_weight_kg` after
 * `weight_net`) or, when it has no sibling, at the end of its section. Each
 * section's comment quotes the reference sequence it mirrors, so a future edit
 * can be checked against it without opening the other app.
 *
 * A row whose `field_key` is not listed below (every admin-added custom row,
 * and any new field added to `sheet_rows.py` before this table is updated) is
 * NOT dropped — it falls through to the trailing "other" section in its
 * original relative order. Losing a row here would hide data.
 */
import type { IRowConfig } from '@/types';
import type { TIosRowOrder } from '@/stores/sheetStore';
import type { IRoleBand } from './sheetRoleBlocks';

interface ITopicSection {
  /** i18n key; the label string carries Sera's emoji, so no component change. */
  labelKey: string;
  /** `field_key`s in the order they should appear inside the section. */
  fields: readonly string[];
}

/** The six sections of the reference screen, in its order. */
export const TOPIC_SECTIONS: readonly ITopicSection[] = [
  {
    // Sera: Kg / Açylan wagty · Ýüklenjek ýeri · Ýygym ýagdaýy · Export Kody
    labelKey: 'sheet.topic.general',
    fields: ['shipment_code', 'block_sources', 'harvest_status', 'export_code'],
  },
  {
    // Sera: Eksport eden Firmalar · Kap / Brutto · Resminamalar · Eksport ýurdy
    //       · Müşderi · Şäheri · Import Firma · Sertnama No / Invoice
    labelKey: 'sheet.topic.cargo_customs',
    fields: [
      'firm_splits',
      'packing',
      'documents_status',
      'country',
      'customer',
      'city',
      'import_firm',
      'firm_contracts',
      // YGT-only, no Sera sibling — appended.
      'transport_docs_given_at',
      'document_note',
      'customs_clearance_planned_day',
    ],
  },
  {
    // Sera: Sürüji F.A. · Sürüji tel. · Plaka · Transport jogapkar
    labelKey: 'sheet.topic.transport',
    fields: [
      'driver_name',
      'driver_phone',
      'truck_plate',
      'vehicle_responsible',
      // YGT-only, no Sera sibling — appended.
      'vehicle_condition',
      'vehicle_live_status',
    ],
  },
  {
    // Sera: Gümrük edilen wagty · Ýüklemäniň başlan/gutaran wagty
    //       · Ýyladyşhanadan çykan wagty · Takmynan ýol güni
    labelKey: 'sheet.topic.loading_times',
    fields: [
      'customs_exit_at',
      'loading_started_at',
      'loading_ended_at',
      'departed_at',
      'transit_days_temp',
      // YGT-only, no Sera sibling — appended.
      'warehouse_note',
    ],
  },
  {
    // Sera: TM çykan nokady · TM çykan wagty · Barmaly ýurduna giren
    //       · Peregruz ýagdaýy · Peregruz wagty · Barmaly nokada gelen
    labelKey: 'sheet.topic.road_border',
    fields: [
      'border_point',
      'border_crossed_at',
      'dest_entry_at',
      // YGT-only; kept beside dest_entry_at, its nearest sibling, rather than
      // pushed to the end — both mark entry into the destination country.
      'customs_entry_at',
      'has_peregruz',
      'peregruz_date',
      'arrived_at',
    ],
  },
  {
    // Sera: Arassa agramy · Pomidor görnüşi · Ýygylan senesi
    //       · Satylyp başlan · Satylyp gutaran · Hasabat gelen
    labelKey: 'sheet.topic.sales_report',
    fields: [
      'weight_net',
      // YGT-only; kept beside weight_net, its nearest sibling.
      'rejected_weight_kg',
      'variety',
      'harvest_date',
      'sale_started_at',
      'sale_ended_at',
      'sales_report_date',
      // YGT-only, no Sera sibling — appended.
      'has_doc_advance',
      'is_gapy_satys',
      'export_manager_note',
      'additional_notes_arap',
    ],
  },
];

/** Section for anything the table above doesn't name — custom rows, new fields.
 *  Exported because a user override may name it: a row can be dragged into or
 *  out of Other like any other section. */
export const OTHER_SECTION_LABEL_KEY = 'sheet.topic.other';

export interface ITopicOrderResult {
  /** The same rows, reordered. Never fewer than were passed in. */
  rows: IRowConfig[];
  /** Band per row index, aligned with `rows`; null except at a section start. */
  bands: (IRoleBand | null)[];
}

/**
 * Reorder `rows` into the topic sections and mark a band at each section start.
 *
 * Rows that are hidden by the user never reach here (the payload is already
 * filtered), so a section can come out empty — an empty section produces no
 * band at all rather than a band heading zero rows.
 */
export function applyTopicOrder(
  rows: IRowConfig[],
  override: TIosRowOrder | null = null,
): ITopicOrderResult {
  const byField = new Map<string, IRowConfig>();
  for (const row of rows) byField.set(row.field_key, row);

  // A field named in ANY override list belongs to that section, whatever the
  // default table says — that is what makes a cross-section move stick.
  const overrideOwner = new Map<string, string>();
  if (override) {
    for (const [labelKey, fields] of Object.entries(override)) {
      for (const field of fields) {
        if (!overrideOwner.has(field)) overrideOwner.set(field, labelKey);
      }
    }
  }

  const claimed = new Set<string>();
  const ordered: IRowConfig[] = [];
  const bands: (IRoleBand | null)[] = [];

  const pushSection = (labelKey: string, sectionRows: IRowConfig[]) => {
    if (sectionRows.length === 0) return;
    bands.push({ labelKey, rowCount: sectionRows.length });
    ordered.push(sectionRows[0]);
    for (let i = 1; i < sectionRows.length; i++) {
      bands.push(null);
      ordered.push(sectionRows[i]);
    }
  };

  /** Rows for one section: the override's order first, then any default
   *  members the override didn't move elsewhere. */
  const collect = (labelKey: string, defaultFields: readonly string[]): IRowConfig[] => {
    const out: IRowConfig[] = [];
    const take = (fieldKey: string) => {
      if (claimed.has(fieldKey)) return;
      const row = byField.get(fieldKey);
      if (!row) return; // hidden, or not in this payload
      out.push(row);
      claimed.add(fieldKey);
    };

    for (const fieldKey of override?.[labelKey] ?? []) take(fieldKey);
    for (const fieldKey of defaultFields) {
      // Skip a default member the user moved into a different section.
      if (overrideOwner.get(fieldKey) !== undefined && overrideOwner.get(fieldKey) !== labelKey) {
        continue;
      }
      take(fieldKey);
    }
    return out;
  };

  for (const section of TOPIC_SECTIONS) {
    pushSection(section.labelKey, collect(section.labelKey, section.fields));
  }

  // Everything still unclaimed, in its original relative order — plus anything
  // the user explicitly moved into Other.
  pushSection(
    OTHER_SECTION_LABEL_KEY,
    collect(
      OTHER_SECTION_LABEL_KEY,
      rows.map((row) => row.field_key),
    ),
  );

  return { rows: ordered, bands };
}

/**
 * Move the row at `fromIndex` to `toIndex` in a rendered topic order, and
 * return the override map that reproduces the result.
 *
 * Section membership follows the drop, not the source: the moved row joins the
 * section of whatever row it lands on. Dropping past the last row joins the
 * last section. That is the only rule a dragging user can predict, and it is
 * what makes both within-section and cross-section moves work with one gesture.
 *
 * Returns the FULL map (every non-empty section, all of its fields), not a
 * patch — so the stored override is always self-describing and a later change
 * to the default table can't silently reshuffle what the user arranged.
 */
export function moveRowInTopicOrder(
  current: ITopicOrderResult,
  fromIndex: number,
  toIndex: number,
): TIosRowOrder | null {
  const { rows, bands } = current;
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || fromIndex >= rows.length) return null;
  if (toIndex < 0 || toIndex >= rows.length) return null;

  // Flatten to (section label, field key), section resolved by the nearest
  // band at or above each row.
  let currentLabel: string | null = null;
  const flat: { labelKey: string; fieldKey: string }[] = rows.map((row, i) => {
    const band = bands[i];
    if (band) currentLabel = band.labelKey;
    return { labelKey: currentLabel ?? OTHER_SECTION_LABEL_KEY, fieldKey: row.field_key };
  });

  const [moved] = flat.splice(fromIndex, 1);
  // After the splice the target slot may be one short; clamp and read the
  // section from the row now occupying it (or the last row when dropping past
  // the end).
  const landing = Math.max(0, Math.min(toIndex, flat.length));
  const neighbour = flat[landing] ?? flat[flat.length - 1];
  flat.splice(landing, 0, {
    labelKey: neighbour ? neighbour.labelKey : moved.labelKey,
    fieldKey: moved.fieldKey,
  });

  const next: TIosRowOrder = {};
  for (const entry of flat) {
    (next[entry.labelKey] ??= []).push(entry.fieldKey);
  }
  return next;
}

/**
 * Snap a freeze row count down to a topic-section boundary.
 *
 * Band rows render only in the scrollable section (`SheetGrid.renderSection`),
 * so a freeze line falling in the middle of a section swallows that section's
 * band and leaves its remaining rows under no header. Snapping the count down
 * to the start of the section it lands in keeps every scrollable section
 * headed; the frozen block is then always a whole number of sections.
 *
 * Returns 0 when the freeze would land inside the very first section — the
 * pinned identity rows then scroll with the rest and keep their own band.
 */
export function sectionAlignedFreeze(
  bands: (IRoleBand | null)[],
  frozenRowCount: number,
): number {
  const wanted = Math.max(0, Math.min(frozenRowCount, bands.length));
  if (wanted === 0) return 0;
  // A band at index `wanted` means the freeze already sits exactly on a
  // section start — nothing to snap.
  if (wanted === bands.length || bands[wanted] !== null) return wanted;
  for (let i = wanted - 1; i > 0; i--) {
    if (bands[i] !== null) return i;
  }
  return 0;
}
