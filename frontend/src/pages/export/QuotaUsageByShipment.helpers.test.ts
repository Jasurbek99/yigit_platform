import { describe, expect, it } from 'vitest';
import {
  MANUAL_GROUP_KEY,
  groupRecordsByShipment,
  totalKg,
} from './QuotaUsageByShipment.helpers';
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
    shipment: 100,
    shipment_code: 'AAA-1',
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    created_by: null,
    created_by_name: null,
    created_at: null,
    ...over,
  } as IQuotaUsageRecord;
}

describe('groupRecordsByShipment', () => {
  it('puts every firm on one truck into a single group', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, export_firm: 4, export_firm_name: 'YGT' }),
      record({ id: 2, export_firm: 7, export_firm_name: 'HJ', kg_used: 6000 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].firmCount).toBe(2);
    expect(groups[0].totalKg).toBe(15000);
    expect(groups[0].shipmentCode).toBe('AAA-1');
  });

  it('counts distinct firms, not records', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, export_firm: 4 }),
      record({ id: 2, export_firm: 4 }),
    ]);
    expect(groups[0].records).toHaveLength(2);
    expect(groups[0].firmCount).toBe(1);
  });

  it('separates different trucks', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, shipment: 100, shipment_code: 'AAA-1' }),
      record({ id: 2, shipment: 200, shipment_code: 'BBB-2' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('collects every shipment-less record into one manual bucket', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, shipment: null, shipment_code: null, export_firm: 4 }),
      record({ id: 2, shipment: null, shipment_code: null, export_firm: 7 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(MANUAL_GROUP_KEY);
    expect(groups[0].records).toHaveLength(2);
  });

  it('pins the manual bucket last even when its dates are newest', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, shipment: null, shipment_code: null, usage_date: '2026-12-31' }),
      record({ id: 2, shipment: 100, usage_date: '2026-01-01' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['s:100', MANUAL_GROUP_KEY]);
  });

  it('sorts trucks newest first', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, shipment: 100, usage_date: '2026-06-01' }),
      record({ id: 2, shipment: 200, usage_date: '2026-06-09' }),
    ]);
    expect(groups.map((g) => g.shipmentId)).toEqual([200, 100]);
  });

  it('shows a truck the earliest date of its records', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, usage_date: '2026-06-05' }),
      record({ id: 2, usage_date: '2026-06-02', export_firm: 7 }),
    ]);
    expect(groups[0].date).toBe('2026-06-02');
  });

  it('coerces decimal strings from the API', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, kg_used: '9000.50' as unknown as number }),
      record({ id: 2, export_firm: 7, kg_used: '600.50' as unknown as number }),
    ]);
    expect(groups[0].totalKg).toBe(9601);
  });

  it('is empty for no records', () => {
    expect(groupRecordsByShipment([])).toEqual([]);
  });
});

describe('totalKg', () => {
  it('sums across groups', () => {
    const groups = groupRecordsByShipment([
      record({ id: 1, shipment: 100, kg_used: 9000 }),
      record({ id: 2, shipment: 200, kg_used: 6000 }),
    ]);
    expect(totalKg(groups)).toBe(15000);
  });

  it('is 0 for no groups', () => {
    expect(totalKg([])).toBe(0);
  });
});
