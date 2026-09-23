import { describe, it, expect } from 'vitest';
import { sumByLocation, truckCountByDay, trucksForDay, isPartialTruck, weekTotal } from './GaplamaTab.totals';
import type { IGaplamaDay, IGaplamaTruck } from '@/types';

const days: IGaplamaDay[] = [
  { date: '2026-09-21', block_id: 1, block_code: 'A', location: 'dusak', plan_kg: 20000, loaded_kg: 12000, carried_in_kg: 0, available_kg: 8000, over_kg: 0 },
  { date: '2026-09-21', block_id: 2, block_code: 'B', location: 'kaka', plan_kg: 5000, loaded_kg: 0, carried_in_kg: 0, available_kg: 5000, over_kg: 0 },
  { date: '2026-09-22', block_id: 1, block_code: 'A', location: 'dusak', plan_kg: 10000, loaded_kg: 0, carried_in_kg: 8000, available_kg: 18000, over_kg: 0 },
];

const trucks: IGaplamaTruck[] = [
  { id: 1, shipment_code: '2109001/26', export_code: null, date: '2026-09-21', status: 1,
    status_code: 'draft', status_display: 'Draft', country: null, customer: null,
    block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 12000 }] },
];

describe('sumByLocation', () => {
  it('groups available_kg by location for a given day', () => {
    expect(sumByLocation(days, '2026-09-21', 'available_kg')).toEqual({ dusak: 8000, kaka: 5000 });
  });
});

describe('truckCountByDay', () => {
  it('counts trucks opened on a given day', () => {
    expect(truckCountByDay(trucks, '2026-09-21')).toBe(1);
    expect(truckCountByDay(trucks, '2026-09-22')).toBe(0);
  });
});

describe('trucksForDay', () => {
  it('filters trucks to one day', () => {
    expect(trucksForDay(trucks, '2026-09-21')).toHaveLength(1);
  });
});

describe('isPartialTruck', () => {
  it('flags a truck under capacity as partial', () => {
    expect(isPartialTruck(trucks[0], 18500)).toBe(true);
  });
  it('does not flag a full truck', () => {
    const full = { ...trucks[0], block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18500 }] };
    expect(isPartialTruck(full, 18500)).toBe(false);
  });
});

describe('weekTotal', () => {
  it('sums a field across all days for one block', () => {
    expect(weekTotal(days, 'available_kg', 1)).toBe(8000 + 18000);
  });
  it('sums a field across all days and all blocks when no blockId given', () => {
    expect(weekTotal(days, 'plan_kg')).toBe(20000 + 5000 + 10000);
  });
});
