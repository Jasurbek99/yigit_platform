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
