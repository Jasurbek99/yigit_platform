import { num } from '@/components/HarvestCell.helpers';
import type { IHarvestDayEntry } from '@/types';

/**
 * The plan/actual pair behind one Total cell.
 *
 * Both numbers, not one: the grid's existing day-total row already shows plan
 * (blue) over actual (green, only once there is one), and a row total that
 * collapsed them into a single figure would disagree with the column it sits at
 * the end of.
 */
export interface IHarvestTotals {
  plan: number;
  actual: number;
}

/**
 * Sum one block's week — the `JEMI` column ported from the sera app.
 *
 * `dateKeys` is the visible week, so hiding Sunday narrows the total to what is
 * actually on screen; a row total that counted a column nobody can see would
 * never add up by eye. A missing entry contributes 0: the cell renders an
 * em-dash, and "not entered" is not a quantity.
 */
export function sumBlockWeek(
  entriesByBlockDay: Map<string, IHarvestDayEntry>,
  blockId: number,
  dateKeys: string[],
): IHarvestTotals {
  return dateKeys.reduce<IHarvestTotals>(
    (acc, date) => {
      const entry = entriesByBlockDay.get(`${blockId}-${date}`);
      return {
        plan: acc.plan + num(entry?.plan_value),
        actual: acc.actual + num(entry?.actual_value),
      };
    },
    { plan: 0, actual: 0 },
  );
}

/**
 * Sum every visible block over the visible week — the bottom-right cell where
 * the Total column meets the total row. Computed from the same per-block
 * function so the corner always equals the sum of the column above it.
 */
export function sumAllBlocks(
  entriesByBlockDay: Map<string, IHarvestDayEntry>,
  blockIds: number[],
  dateKeys: string[],
): IHarvestTotals {
  return blockIds.reduce<IHarvestTotals>(
    (acc, blockId) => {
      const row = sumBlockWeek(entriesByBlockDay, blockId, dateKeys);
      return { plan: acc.plan + row.plan, actual: acc.actual + row.actual };
    },
    { plan: 0, actual: 0 },
  );
}
