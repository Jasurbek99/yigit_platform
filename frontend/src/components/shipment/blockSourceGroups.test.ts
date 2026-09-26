import { describe, it, expect } from 'vitest';
import { compareBatchesByHarvestDate } from './blockSourceGroups';
import type { IBlockSource } from '@/types';

function batch(weight_kg: number, harvest_date: string | null): IBlockSource {
  return { block_code: 'A', block_name: 'A', weight_kg, harvest_date };
}

/**
 * These call the comparator directly with two batches and assert the
 * returned number, rather than sorting a small array and checking the
 * result — `ShipmentGoodsBody.test.tsx` had exactly that shape for the
 * null/null tie and it passed identically whether the comparator's tie
 * branch returned 0 (correct) or 1 (the bug this guards): V8 does not
 * reliably call a 2-element array's comparator in both argument orders, so
 * the asymmetry a broken tie branch introduces never got exercised.
 */
describe('compareBatchesByHarvestDate', () => {
  it('returns 0 for two null dates, in both argument orders', () => {
    const a = batch(3000, null);
    const b = batch(5000, null);
    expect(compareBatchesByHarvestDate(a, b)).toBe(0);
    expect(compareBatchesByHarvestDate(b, a)).toBe(0);
  });

  it('sorts a null date after a real date, consistently in both orders', () => {
    const dated = batch(3000, '2026-09-21');
    const undated = batch(5000, null);
    // Antisymmetry: swapping the arguments must flip the sign, not just
    // "also return something reasonable".
    expect(compareBatchesByHarvestDate(dated, undated)).toBeLessThan(0);
    expect(compareBatchesByHarvestDate(undated, dated)).toBeGreaterThan(0);
  });

  it('sorts two real dates oldest first', () => {
    const older = batch(3000, '2026-09-21');
    const newer = batch(5000, '2026-09-24');
    expect(compareBatchesByHarvestDate(older, newer)).toBeLessThan(0);
    expect(compareBatchesByHarvestDate(newer, older)).toBeGreaterThan(0);
  });

  it('returns 0 for two equal real dates', () => {
    const a = batch(3000, '2026-09-21');
    const b = batch(5000, '2026-09-21');
    expect(compareBatchesByHarvestDate(a, b)).toBe(0);
  });
});
