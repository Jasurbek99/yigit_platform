import { describe, expect, it } from 'vitest';
import {
  cellKey,
  groupRecordsByCell,
  isCellInlineEditable,
  sumKg,
} from './QuotaUsageGrid.helpers';
import type { IQuotaUsageRecord } from '@/types';

function record(over: Partial<IQuotaUsageRecord> & { id: number }): IQuotaUsageRecord {
  return {
    usage_date: '2026-06-01',
    export_firm: 4,
    export_firm_name: 'YGT',
    kg_used: 9000,
    product_type: 'tomato',
    status: 'approved',
    notes: '',
    shipment: null,
    shipment_code: null,
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    created_by: null,
    created_by_name: null,
    created_at: null,
    ...over,
  } as IQuotaUsageRecord;
}

describe('groupRecordsByCell', () => {
  it('keeps every record when one firm has several trucks on one day', () => {
    const records = [
      record({ id: 1, kg_used: 9000 }),
      record({ id: 2, kg_used: 6000 }),
      record({ id: 3, kg_used: 3100 }),
    ];
    const map = groupRecordsByCell(records);
    expect(map.get(cellKey('2026-06-01', 4))).toHaveLength(3);
  });

  it('separates different firms on the same date', () => {
    const map = groupRecordsByCell([
      record({ id: 1, export_firm: 4 }),
      record({ id: 2, export_firm: 7 }),
    ]);
    expect(map.get(cellKey('2026-06-01', 4))).toHaveLength(1);
    expect(map.get(cellKey('2026-06-01', 7))).toHaveLength(1);
  });

  it('separates the same firm on different dates', () => {
    const map = groupRecordsByCell([
      record({ id: 1, usage_date: '2026-06-01' }),
      record({ id: 2, usage_date: '2026-06-02' }),
    ]);
    expect(map.get(cellKey('2026-06-01', 4))).toHaveLength(1);
    expect(map.get(cellKey('2026-06-02', 4))).toHaveLength(1);
  });

  it('returns nothing for a cell with no records', () => {
    expect(groupRecordsByCell([]).get(cellKey('2026-06-01', 4))).toBeUndefined();
  });
});

describe('sumKg', () => {
  it('sums the whole cell rather than reporting one record', () => {
    expect(
      sumKg([record({ id: 1, kg_used: 9000 }), record({ id: 2, kg_used: 6000 })]),
    ).toBe(15000);
  });

  it('coerces decimal strings from the API', () => {
    const rows = [
      record({ id: 1, kg_used: '9000.50' as unknown as number }),
      record({ id: 2, kg_used: '600.50' as unknown as number }),
    ];
    expect(sumKg(rows)).toBe(9601);
  });

  it('is 0 for an empty cell', () => {
    expect(sumKg([])).toBe(0);
  });
});

describe('isCellInlineEditable', () => {
  it('allows creating in an empty cell when permitted', () => {
    expect(isCellInlineEditable([], false, true)).toBe(true);
    expect(isCellInlineEditable([], false, false)).toBe(false);
  });

  it('allows editing a lone record', () => {
    expect(isCellInlineEditable([record({ id: 1 })], true, false)).toBe(true);
  });

  it('refuses a lone record without edit permission', () => {
    expect(isCellInlineEditable([record({ id: 1 })], false, true)).toBe(false);
  });

  it('ignores status — every row is approved since the approval step was removed', () => {
    expect(isCellInlineEditable([record({ id: 1, status: 'approved' })], true, false)).toBe(true);
  });

  it('refuses a multi-record cell however editable each row is', () => {
    const rows = [record({ id: 1 }), record({ id: 2 })];
    expect(isCellInlineEditable(rows, true, true)).toBe(false);
  });
});
