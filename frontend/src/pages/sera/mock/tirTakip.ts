/**
 * Sera Bütçe — Maşyn Yzarlama (Tır Takip) page mock data.
 *
 * Weekly kg figures per block feeding the truck-dispatch grid, derived from
 * the weekly production plan (see mock/uretimPlani.ts for the plan itself).
 * "Dusak A" matches the source app's reference screenshot exactly — 15.000 kg
 * / 16.000 kg on the first two days of the displayed week, 0 afterwards
 * (managers only fill the plan a day or two ahead). Every other block follows
 * the same "today + tomorrow only" shape, scaled from that block's yearly
 * production (mock/seraData.ts); blocks with 0 yearly production (still
 * under conversion — e.g. Dusak 1-10, Kaka N/P) show 0 across the week.
 */
import { SERA_BLOCKS } from './seraData';

/** One truck ≈ 20.000 kg of tomatoes (matches the source app's divisor). */
export const TIR_TRUCK_CAPACITY_KG = 20000;

function weeklyPattern(productionKg: number): number[] {
  if (productionKg <= 0) return [0, 0, 0, 0, 0, 0, 0];
  const day0 = Math.round(productionKg / 280 / 500) * 500;
  const day1 = Math.round((day0 * 1.06) / 500) * 500;
  return [day0, day1, 0, 0, 0, 0, 0];
}

export const TIR_WEEKLY_KG_BY_BLOCK: Record<string, number[]> = Object.fromEntries(
  SERA_BLOCKS.map((b) => [b.id, weeklyPattern(b.productionKg)]),
);

// Exact reference figures from the source app screenshot.
TIR_WEEKLY_KG_BY_BLOCK['DUS-A'] = [15000, 16000, 0, 0, 0, 0, 0];
