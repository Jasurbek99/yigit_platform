import { describe, it, expect } from 'vitest';
import { sumBlockWeek, sumAllBlocks } from './OnumcilikTab.totals';
import type { IHarvestDayEntry } from '@/types';

/** Only the three fields the totals read; the real row carries ~25 more. */
function entry(
  block: number,
  date: string,
  plan: string | null,
  actual: string | null = null,
): [string, IHarvestDayEntry] {
  return [
    `${block}-${date}`,
    { block, entry_date: date, plan_value: plan, actual_value: actual } as IHarvestDayEntry,
  ];
}

const MON_TO_WED = ['2026-09-14', '2026-09-15', '2026-09-16'];

describe('sumBlockWeek', () => {
  it('adds the plan and actual values of one block across the week', () => {
    const map = new Map([
      entry(7, '2026-09-14', '1000', '900'),
      entry(7, '2026-09-15', '2000', '2100'),
      entry(7, '2026-09-16', '3000', null),
    ]);

    expect(sumBlockWeek(map, 7, MON_TO_WED)).toEqual({ plan: 6000, actual: 3000 });
  });

  it('counts a missing day as zero rather than skipping the row', () => {
    // The cell renders an em-dash for a missing entry — "not entered" is not a
    // quantity, so it must not shift the total either way.
    const map = new Map([entry(7, '2026-09-15', '2000')]);

    expect(sumBlockWeek(map, 7, MON_TO_WED)).toEqual({ plan: 2000, actual: 0 });
  });

  it('ignores days outside the visible week', () => {
    // Hiding Sunday narrows `dateKeys`, and the total must narrow with it or it
    // stops matching the columns a reader can actually add up.
    const map = new Map([
      entry(7, '2026-09-16', '3000'),
      entry(7, '2026-09-20', '9999'),
    ]);

    expect(sumBlockWeek(map, 7, MON_TO_WED).plan).toBe(3000);
  });

  it('keeps blocks apart', () => {
    const map = new Map([
      entry(7, '2026-09-14', '1000'),
      entry(8, '2026-09-14', '5000'),
    ]);

    expect(sumBlockWeek(map, 7, MON_TO_WED).plan).toBe(1000);
    expect(sumBlockWeek(map, 8, MON_TO_WED).plan).toBe(5000);
  });
});

describe('sumAllBlocks', () => {
  it('equals the sum of the per-block rows above it', () => {
    const map = new Map([
      entry(7, '2026-09-14', '1000', '900'),
      entry(8, '2026-09-15', '2500', '2500'),
      entry(9, '2026-09-16', '400', null),
    ]);

    const corner = sumAllBlocks(map, [7, 8, 9], MON_TO_WED);
    const byRow = [7, 8, 9]
      .map((b) => sumBlockWeek(map, b, MON_TO_WED))
      .reduce((a, r) => ({ plan: a.plan + r.plan, actual: a.actual + r.actual }), {
        plan: 0,
        actual: 0,
      });

    expect(corner).toEqual(byRow);
    expect(corner).toEqual({ plan: 3900, actual: 3400 });
  });

  it('is zero for an empty week', () => {
    expect(sumAllBlocks(new Map(), [7, 8], MON_TO_WED)).toEqual({ plan: 0, actual: 0 });
  });
});
