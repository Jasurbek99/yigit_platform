/**
 * Pure display-sum helpers for the Gaplama grid. These only aggregate what
 * build_gaplama_board() already returns — none of them re-derive the carry-over
 * rule, which is server-owned (design spec D8).
 */
import type { IGaplamaDay, IGaplamaTruck } from '@/types';

export function sumByLocation(
  days: IGaplamaDay[],
  date: string,
  field: 'plan_kg' | 'loaded_kg' | 'available_kg',
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of days) {
    if (row.date !== date) continue;
    const key = row.location ?? 'other';
    out[key] = (out[key] ?? 0) + row[field];
  }
  return out;
}

export function trucksForDay(trucks: IGaplamaTruck[], date: string): IGaplamaTruck[] {
  return trucks.filter((t) => t.date === date);
}

export function truckCountByDay(trucks: IGaplamaTruck[], date: string): number {
  return trucksForDay(trucks, date).length;
}

export function truckTotalKg(truck: IGaplamaTruck): number {
  return truck.block_sources.reduce((sum, s) => sum + s.weight_kg, 0);
}

export function isPartialTruck(truck: IGaplamaTruck, truckCapacityKg: number): boolean {
  return truckTotalKg(truck) < truckCapacityKg;
}

export function weekTotal(
  days: IGaplamaDay[],
  field: 'plan_kg' | 'loaded_kg' | 'available_kg',
  blockId?: number,
): number {
  return days
    .filter((d) => blockId === undefined || d.block_id === blockId)
    .reduce((sum, d) => sum + d[field], 0);
}

/**
 * Truck count from a kg-per-location map — floors EACH location's own kg
 * before summing (D16: two locations with 10 000 kg each is not one truck,
 * a truck can't load across locations), never `Math.floor(totalKg / cap)`.
 */
export function truckCountByLocation(
  kgByLocation: Record<string, number>,
  truckCapacityKg: number,
): number {
  if (truckCapacityKg <= 0) return 0;
  return Object.values(kgByLocation).reduce((sum, kg) => sum + Math.floor(kg / truckCapacityKg), 0);
}

export interface IGaplamaFormBatch {
  harvest_date: string | null;
  age_days: number;
  available_kg: number;
}

/**
 * Collapses a day's live carry-in buckets (each a still-open harvest day,
 * per the board's own FIFO breakdown) into ONE leftover figure — the
 * loading/packing hall physically mixes these crates once consolidated in
 * the hall, so a per-date pick has no counterpart on the floor (owner +
 * loading/packaging head, 2026-09-24: batch-selection removed from the
 * truck form). The available kg is the buckets' sum; the age is the OLDEST
 * bucket's age_days, an upper bound — nothing older survives, since the
 * board expires a bucket once it exceeds the block's own carry_days.
 * Returns null when there is nothing to carry (an empty leftover row would
 * offer nothing to load).
 */
export function collapseCarryIn(
  buckets: { origin_date: string; kg: number; age_days: number }[],
): { age_days: number; available_kg: number } | null {
  const available_kg = buckets.reduce((sum, b) => sum + b.kg, 0);
  if (available_kg <= 0) return null;
  const age_days = buckets.reduce((max, b) => Math.max(max, b.age_days), 0);
  return { age_days, available_kg };
}

/**
 * The truck form's batch list for one block/day — at most two rows: today's
 * own plan (dated `date`, age 0) and the block's collapsed leftover (see
 * `collapseCarryIn`). A zero-plan day omits the today row; a block with
 * nothing carried in omits the leftover row — an empty row would offer
 * nothing to load.
 */
export function buildBlockBatches(
  row: { plan_kg: number; carry_in_breakdown: { origin_date: string; kg: number; age_days: number }[] } | undefined,
  date: string,
): IGaplamaFormBatch[] {
  const batches: IGaplamaFormBatch[] = [];
  const leftover = collapseCarryIn(row?.carry_in_breakdown ?? []);
  if (leftover) batches.push({ harvest_date: null, ...leftover });
  if ((row?.plan_kg ?? 0) > 0) batches.push({ harvest_date: date, age_days: 0, available_kg: row!.plan_kg });
  return batches;
}
