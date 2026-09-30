import { describe, it, expect } from 'vitest';
import type { IShipmentDraft } from '@/types';
import { cardDetails } from './assignmentHelpers';

function row(over: Partial<IShipmentDraft> = {}): IShipmentDraft {
  return {
    id: 1, shipment_code: 'C1', date: '2026-09-29', created_at: '2026-09-29T06:00:00Z',
    created_by_name: null, weight_net: null, block_sources: [], export_code: null,
    previous_platform_id: null, harvest_age_days: 0, freshness: 'today', variety_confidence: 'none',
    ...over,
  };
}
const label = (code: string) => `L:${code}`;
// ru-RU grouping inserts a (narrow) no-break space — compare with plain spaces.
const plain = (s: string | undefined) => (s ?? '').replace(/[  ]/g, ' ');
const valueOf = (details: { key: string; value: string }[], key: string) =>
  details.find((d) => d.key === key)?.value;

describe('cardDetails', () => {
  it('shows only the date for a row with nothing else filled', () => {
    expect(cardDetails(row(), label).map((d) => d.key)).toEqual(['date']);
  });

  it("sums one block's batches and keeps the blocks in order", () => {
    const d = cardDetails(row({ block_sources: [
      { block_code: 'A', weight_kg: 6000 },
      { block_code: 'B', weight_kg: 3000 },
      { block_code: 'A', weight_kg: 3000 },
    ] }), label);
    expect(plain(valueOf(d, 'blocks'))).toBe('A 9 000 · B 3 000');
  });

  it('shows just the code for a block with no weight yet', () => {
    const d = cardDetails(row({ block_sources: [{ block_code: 'A', weight_kg: null }] }), label);
    expect(valueOf(d, 'blocks')).toBe('A');
  });

  it('maps the harvest status code through the label lookup', () => {
    expect(valueOf(cardDetails(row({ harvest_status: 'fresh' }), label), 'harvest_status')).toBe('L:fresh');
  });

  it('joins destination, truck and creator parts, skipping the empty ones', () => {
    const d = cardDetails(row({
      country_name: 'Kazakhstan', city_name: null,
      truck_plate: '12AB', driver_name: null, driver_phone: '+993 65',
      created_by_name: 'Aman',
    }), label);
    expect(valueOf(d, 'destination')).toBe('Kazakhstan');
    expect(valueOf(d, 'truck')).toBe('12AB · +993 65');
    expect(valueOf(d, 'created')).toMatch(/^Aman · 29\.09/);
  });

  it('shows gapy only when it is set', () => {
    expect(valueOf(cardDetails(row({ is_gapy_satys: false }), label), 'gapy')).toBeUndefined();
    expect(valueOf(cardDetails(row({ is_gapy_satys: true }), label), 'gapy')).toBe('✓');
  });

  it('shows the import firm only when it differs from the customer', () => {
    const same = cardDetails(row({ customer_name: 'Firm', import_firm_name: 'Firm' }), label);
    expect(valueOf(same, 'import_firm')).toBeUndefined();
    const other = cardDetails(row({ customer_name: 'Firm', import_firm_name: 'Other' }), label);
    expect(valueOf(other, 'import_firm')).toBe('Other');
  });

  it('lists every filled field in display order', () => {
    const d = cardDetails(row({
      block_sources: [{ block_code: 'A', weight_kg: 9000 }],
      harvest_status: 'fresh', variety_name: 'Pink',
      country_name: 'KZ', customer_name: 'Buyer', import_firm_name: 'Importer',
      export_firms_display: 'YGT', border_point_name: 'Farap', is_gapy_satys: true,
      truck_plate: '12AB', notes: 'n1', export_manager_note: 'n2', created_by_name: 'Aman',
    }), label);
    expect(d.map((x) => x.key)).toEqual([
      'blocks', 'date', 'harvest_status', 'variety', 'destination', 'customer', 'import_firm',
      'export_firms', 'border_point', 'gapy', 'truck', 'notes', 'export_manager_note', 'created',
    ]);
  });
});
