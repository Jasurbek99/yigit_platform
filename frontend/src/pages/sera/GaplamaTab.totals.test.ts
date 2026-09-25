import { describe, it, expect } from 'vitest';
import { sumByLocation, truckCountByDay, trucksForDay, isPartialTruck, weekTotal, truckTotalKg, truckCountByLocation, collapseCarryIn, buildBlockBatches } from './GaplamaTab.totals';
import type { IGaplamaDay, IGaplamaTruck } from '@/types';

const days: IGaplamaDay[] = [
  { date: '2026-09-21', block_id: 1, block_code: 'A', location: 'dusak', plan_kg: 20000, loaded_kg: 12000, carried_in_kg: 0, carry_in_breakdown: [], available_kg: 8000, over_kg: 0, carried_out_kg: 0 },
  { date: '2026-09-21', block_id: 2, block_code: 'B', location: 'kaka', plan_kg: 5000, loaded_kg: 0, carried_in_kg: 0, carry_in_breakdown: [], available_kg: 5000, over_kg: 0, carried_out_kg: 0 },
  { date: '2026-09-22', block_id: 1, block_code: 'A', location: 'dusak', plan_kg: 10000, loaded_kg: 0, carried_in_kg: 8000, carry_in_breakdown: [{ origin_date: '2026-09-21', kg: 8000, age_days: 1 }], available_kg: 18000, over_kg: 0, carried_out_kg: 0 },
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
  it('buckets null-location rows under the "other" key', () => {
    const daysWithNull: IGaplamaDay[] = [
      { date: '2026-09-21', block_id: 1, block_code: 'A', location: 'dusak', plan_kg: 20000, loaded_kg: 12000, carried_in_kg: 0, carry_in_breakdown: [], available_kg: 8000, over_kg: 0, carried_out_kg: 0 },
      { date: '2026-09-21', block_id: 2, block_code: 'B', location: null, plan_kg: 5000, loaded_kg: 0, carried_in_kg: 0, carry_in_breakdown: [], available_kg: 5000, over_kg: 0, carried_out_kg: 0 },
    ];
    expect(sumByLocation(daysWithNull, '2026-09-21', 'available_kg')).toEqual({ dusak: 8000, other: 5000 });
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

describe('truckTotalKg', () => {
  it('sums weight_kg from a single block source', () => {
    expect(truckTotalKg(trucks[0])).toBe(12000);
  });
  it('sums weight_kg across multiple block sources', () => {
    const multiBlock: IGaplamaTruck = {
      id: 2,
      shipment_code: '2109002/26',
      export_code: null,
      date: '2026-09-21',
      status: 1,
      status_code: 'draft',
      status_display: 'Draft',
      country: null,
      customer: null,
      block_sources: [
        { block_id: 1, block_code: 'A', weight_kg: 10000 },
        { block_id: 2, block_code: 'B', weight_kg: 8000 },
        { block_id: 3, block_code: 'C', weight_kg: 2000 },
      ],
    };
    expect(truckTotalKg(multiBlock)).toBe(20000);
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

describe('truckCountByLocation', () => {
  // D16: a truck can't load across locations, so two locations each holding
  // 10 000 kg (< 18 500 alone) must never combine into "1 truck" just
  // because their sum crosses the capacity.
  it('floors each location before summing, never floors the grand total', () => {
    expect(truckCountByLocation({ dusak: 10000, kaka: 10000 }, 18500)).toBe(0);
  });
  it('sums whole trucks across locations once each clears capacity on its own', () => {
    expect(truckCountByLocation({ dusak: 37000, kaka: 18500 }, 18500)).toBe(3);
  });
  it('returns 0 for an empty map', () => {
    expect(truckCountByLocation({}, 18500)).toBe(0);
  });
});

// 2026-09-25: per-date leftover picking removed (owner + loading/packaging
// head — leftover crates are physically mixed in the hall, so "the 21.09
// batch" has no counterpart on the floor). collapseCarryIn/buildBlockBatches
// replace the old one-row-per-carry-date list with at most two rows.
describe('collapseCarryIn', () => {
  it('sums three live leftover buckets into one leftover figure', () => {
    const result = collapseCarryIn([
      { origin_date: '2026-09-18', kg: 1000, age_days: 6 },
      { origin_date: '2026-09-20', kg: 2000, age_days: 4 },
      { origin_date: '2026-09-22', kg: 1500, age_days: 2 },
    ]);
    expect(result).toEqual({ age_days: 6, available_kg: 4500 });
  });

  it("states the oldest bucket's age, not the newest or an average", () => {
    // Out of order on purpose — the oldest (age 6) is listed second.
    const result = collapseCarryIn([
      { origin_date: '2026-09-20', kg: 2000, age_days: 4 },
      { origin_date: '2026-09-18', kg: 1000, age_days: 6 },
    ]);
    expect(result?.age_days).toBe(6); // not 4 (newest) and not 5 (average)
  });

  it('returns null when there is nothing to carry', () => {
    expect(collapseCarryIn([])).toBeNull();
  });
});

describe('buildBlockBatches', () => {
  it('shows only the leftover row when there is no plan today', () => {
    const result = buildBlockBatches(
      { plan_kg: 0, carry_in_breakdown: [{ origin_date: '2026-09-21', kg: 3000, age_days: 3 }] },
      '2026-09-24',
    );
    expect(result).toEqual([{ harvest_date: null, age_days: 3, available_kg: 3000 }]);
  });

  it('shows only today\'s row when the block has no leftover to carry', () => {
    const result = buildBlockBatches({ plan_kg: 9000, carry_in_breakdown: [] }, '2026-09-24');
    expect(result).toEqual([{ harvest_date: '2026-09-24', age_days: 0, available_kg: 9000 }]);
  });

  it('shows both rows — leftover first — when there is a plan today and a carried-over leftover', () => {
    const result = buildBlockBatches(
      { plan_kg: 9000, carry_in_breakdown: [{ origin_date: '2026-09-21', kg: 3000, age_days: 3 }] },
      '2026-09-24',
    );
    expect(result).toEqual([
      { harvest_date: null, age_days: 3, available_kg: 3000 },
      { harvest_date: '2026-09-24', age_days: 0, available_kg: 9000 },
    ]);
  });

  it('returns an empty list when there is no board row at all for the day', () => {
    expect(buildBlockBatches(undefined, '2026-09-24')).toEqual([]);
  });
});
