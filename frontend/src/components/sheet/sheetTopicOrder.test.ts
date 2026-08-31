/**
 * Topic order (iOS design variant).
 *
 * The load-bearing property is that reordering NEVER loses a row: the sheet is
 * the operational record, and a field_key missing from the table below must
 * still render. The rest locks the section grouping and band placement.
 */
import { describe, it, expect } from 'vitest';
import type { IRowConfig } from '@/types';
import {
  applyTopicOrder,
  moveRowInTopicOrder,
  sectionAlignedFreeze,
  TOPIC_SECTIONS,
} from './sheetTopicOrder';

function row(fieldKey: string, rowNumber = 1): IRowConfig {
  return {
    row_number: rowNumber,
    field_key: fieldKey,
    default_who_key: 'sheet.who.none',
    label_key: `sheet.row.${fieldKey}`,
    input_type: 'text',
    style: 'base',
  } as IRowConfig;
}

describe('applyTopicOrder', () => {
  it('keeps every row — nothing is dropped, whatever the payload holds', () => {
    // Coverage of the LIVE row list against TOPIC_SECTIONS is checked on the
    // backend (apps.export.tests_sheet_topic_order), which can read
    // sheet_rows.py — the source of truth — instead of a fixture that drifts.
    const rows = [
      ...TOPIC_SECTIONS.flatMap((s) => s.fields),
      'a_custom_row',
      'another_custom_row',
    ].map((f, i) => row(f, i + 1));
    const { rows: ordered } = applyTopicOrder(rows);

    expect(ordered).toHaveLength(rows.length);
    expect(new Set(ordered.map((r) => r.field_key))).toEqual(
      new Set(rows.map((r) => r.field_key)),
    );
  });

  it('groups rows into the reference screen’s section order', () => {
    const rows = [
      row('arrived_at'),
      row('shipment_code'),
      row('driver_name'),
      row('country'),
      row('weight_net'),
      row('loading_started_at'),
    ];
    const { rows: ordered } = applyTopicOrder(rows);

    expect(ordered.map((r) => r.field_key)).toEqual([
      'shipment_code', // general
      'country', // cargo & customs
      'driver_name', // transport
      'loading_started_at', // loading times
      'arrived_at', // road & border
      'weight_net', // sales & report
    ]);
  });

  it('follows the reference screen’s sequence inside each section', () => {
    // The reference (Sera Bütçe → Tır Takip → Tırlar) sequence per section.
    // A YGT-only field is allowed to sit anywhere among these, but the fields
    // the reference HAS must keep its relative order — the thing that was wrong
    // the first time round.
    const REFERENCE: Record<string, string[]> = {
      'sheet.topic.general': ['shipment_code', 'block_sources', 'harvest_status', 'export_code'],
      'sheet.topic.cargo_customs': [
        'firm_splits', 'packing', 'documents_status', 'country',
        'customer', 'city', 'import_firm', 'firm_contracts',
      ],
      'sheet.topic.transport': ['driver_name', 'driver_phone', 'truck_plate', 'vehicle_responsible'],
      'sheet.topic.loading_times': [
        'customs_exit_at', 'loading_started_at', 'loading_ended_at',
        'departed_at', 'transit_days_temp',
      ],
      'sheet.topic.road_border': [
        'border_point', 'border_crossed_at', 'dest_entry_at',
        'has_peregruz', 'peregruz_date', 'arrived_at',
      ],
      'sheet.topic.sales_report': [
        'weight_net', 'variety', 'harvest_date',
        'sale_started_at', 'sale_ended_at', 'sales_report_date',
      ],
    };

    for (const section of TOPIC_SECTIONS) {
      const expected = REFERENCE[section.labelKey];
      expect(expected, `no reference sequence for ${section.labelKey}`).toBeDefined();
      const actual = section.fields.filter((f) => expected.includes(f));
      expect(actual, `section ${section.labelKey} diverges from the reference`).toEqual(expected);
    }
  });

  it('marks one band at each section start, counting that section’s rows', () => {
    const rows = [row('shipment_code'), row('export_code'), row('driver_name')];
    const { bands } = applyTopicOrder(rows);

    expect(bands[0]).toEqual({ labelKey: 'sheet.topic.general', rowCount: 2 });
    expect(bands[1]).toBeNull();
    expect(bands[2]).toEqual({ labelKey: 'sheet.topic.transport', rowCount: 1 });
  });

  it('emits no band for a section whose rows are all hidden', () => {
    const rows = [row('shipment_code'), row('driver_name')];
    const { bands } = applyTopicOrder(rows);

    const labels = bands.filter((b) => b !== null).map((b) => b!.labelKey);
    expect(labels).toEqual(['sheet.topic.general', 'sheet.topic.transport']);
    expect(labels).not.toContain('sheet.topic.cargo_customs');
  });

  it('sends an unknown field to the trailing "other" section, in payload order', () => {
    const rows = [row('custom_row_b'), row('shipment_code'), row('custom_row_a')];
    const { rows: ordered, bands } = applyTopicOrder(rows);

    expect(ordered.map((r) => r.field_key)).toEqual([
      'shipment_code',
      'custom_row_b',
      'custom_row_a',
    ]);
    expect(bands[1]).toEqual({ labelKey: 'sheet.topic.other', rowCount: 2 });
  });

  it('lists no field twice across sections', () => {
    const all = TOPIC_SECTIONS.flatMap((s) => s.fields);
    expect(new Set(all).size).toBe(all.length);
  });

  it('returns an empty result for an empty payload', () => {
    expect(applyTopicOrder([])).toEqual({ rows: [], bands: [] });
  });
});

describe('sectionAlignedFreeze', () => {
  // Bands render only below the freeze line, so the freeze must never land
  // mid-section — that would leave the rest of that section unheaded.
  const bands = applyTopicOrder([
    row('shipment_code'),
    row('export_code'),
    row('block_sources'),
    row('harvest_status'),
    row('firm_splits'),
    row('country'),
    row('driver_name'),
  ]).bands;

  it('snaps a mid-section freeze back to that section’s start', () => {
    // 5 = one row into the cargo section (which starts at index 4).
    expect(sectionAlignedFreeze(bands, 5)).toBe(4);
  });

  it('leaves a freeze that already sits on a section start alone', () => {
    expect(sectionAlignedFreeze(bands, 4)).toBe(4);
    expect(sectionAlignedFreeze(bands, 6)).toBe(6);
  });

  it('drops to zero rather than splitting the first section', () => {
    expect(sectionAlignedFreeze(bands, 2)).toBe(0);
  });

  it('handles no freeze and an over-long freeze', () => {
    expect(sectionAlignedFreeze(bands, 0)).toBe(0);
    expect(sectionAlignedFreeze(bands, 999)).toBe(bands.length);
    expect(sectionAlignedFreeze([], 5)).toBe(0);
  });
});

describe('iOS row-order override', () => {
  // Six rows: general(2) + cargo(2) + transport(2).
  const ROWS = [
    row('shipment_code'), row('export_code'),
    row('firm_splits'), row('country'),
    row('driver_name'), row('driver_phone'),
  ];
  const labels = (r: ReturnType<typeof applyTopicOrder>) => r.rows.map((x) => x.field_key);
  const sections = (r: ReturnType<typeof applyTopicOrder>) =>
    r.bands.filter((b) => b !== null).map((b) => b!.labelKey);

  it('is a no-op with no override', () => {
    expect(labels(applyTopicOrder(ROWS, null))).toEqual(labels(applyTopicOrder(ROWS)));
  });

  it('reorders within a section', () => {
    const moved = moveRowInTopicOrder(applyTopicOrder(ROWS), 1, 0);
    expect(moved).not.toBeNull();
    expect(labels(applyTopicOrder(ROWS, moved))).toEqual([
      'export_code', 'shipment_code', 'firm_splits', 'country', 'driver_name', 'driver_phone',
    ]);
  });

  it('moves a row into the section it is dropped on', () => {
    // driver_name (index 4, Transport) dropped on index 0 (General).
    const moved = moveRowInTopicOrder(applyTopicOrder(ROWS), 4, 0);
    const result = applyTopicOrder(ROWS, moved);

    expect(labels(result)[0]).toBe('driver_name');
    expect(moved!['sheet.topic.general']).toEqual(['driver_name', 'shipment_code', 'export_code']);
    expect(moved!['sheet.topic.transport']).toEqual(['driver_phone']);
  });

  it('drops the band of a section it empties, and keeps the rest', () => {
    let override = moveRowInTopicOrder(applyTopicOrder(ROWS), 4, 0);
    const afterFirst = applyTopicOrder(ROWS, override);
    override = moveRowInTopicOrder(afterFirst, afterFirst.rows.findIndex((r) => r.field_key === 'driver_phone'), 0);
    const result = applyTopicOrder(ROWS, override);

    expect(sections(result)).toEqual(['sheet.topic.general', 'sheet.topic.cargo_customs']);
    expect(labels(result)).toHaveLength(ROWS.length);
  });

  it('never loses or duplicates a row, wherever it is dropped', () => {
    for (let from = 0; from < ROWS.length; from++) {
      for (let to = 0; to < ROWS.length; to++) {
        const override = moveRowInTopicOrder(applyTopicOrder(ROWS), from, to);
        const out = labels(applyTopicOrder(ROWS, override));
        expect(out, `move ${from}->${to}`).toHaveLength(ROWS.length);
        expect(new Set(out).size, `move ${from}->${to}`).toBe(ROWS.length);
      }
    }
  });

  it('returns null for a no-op or out-of-range move', () => {
    const current = applyTopicOrder(ROWS);
    expect(moveRowInTopicOrder(current, 2, 2)).toBeNull();
    expect(moveRowInTopicOrder(current, -1, 0)).toBeNull();
    expect(moveRowInTopicOrder(current, 0, 99)).toBeNull();
  });

  it('still shows a field the override never mentions', () => {
    const override = { 'sheet.topic.general': ['export_code'] };
    // shipment_code is absent from the override but keeps its default section.
    expect(labels(applyTopicOrder(ROWS, override))).toContain('shipment_code');
    expect(labels(applyTopicOrder(ROWS, override))).toHaveLength(ROWS.length);
  });

  it('ignores an override naming a field that is not in the payload', () => {
    const override = { 'sheet.topic.general': ['gone_field', 'shipment_code'] };
    const out = labels(applyTopicOrder(ROWS, override));
    expect(out).not.toContain('gone_field');
    expect(out).toHaveLength(ROWS.length);
  });
});
