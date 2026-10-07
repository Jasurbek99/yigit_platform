import { describe, expect, it } from 'vitest';
import { productTotals, type IPlanGridRow } from './WeeklyPlanGrid.rows';

const row = (block: number, product_code: string | null) => ({ block, product_code }) as unknown as IPlanGridRow;

describe('productTotals', () => {
  it('sums per product, null counts as tomato, tomato first', () => {
    const rows = [row(1, 'pepper'), row(2, 'tomato'), row(3, null)];
    const kg: Record<number, number> = { 1: 100, 2: 200, 3: 50 };
    expect(productTotals(rows, (r) => kg[r.block])).toEqual([
      { code: 'tomato', total: 250 },
      { code: 'pepper', total: 100 },
    ]);
  });
  it('one product only → one entry', () => {
    expect(productTotals([row(1, 'tomato')], () => 10)).toEqual([{ code: 'tomato', total: 10 }]);
  });
});
