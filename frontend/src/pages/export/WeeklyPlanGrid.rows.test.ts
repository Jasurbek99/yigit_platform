import { describe, it, expect } from 'vitest';
import { buildPlanGridRows } from './WeeklyPlanGrid.rows';
import type { IGreenhouseBlock, IWeeklyHarvestPlan } from '@/types';

function block(over: Partial<IGreenhouseBlock> & { id: number; code: string }): IGreenhouseBlock {
  return {
    name: `Block ${over.code}`,
    parent: null,
    location: null,
    location_name: null,
    sort_order: 0,
    is_active: true,
    ...over,
  } as IGreenhouseBlock;
}

function plan(over: Partial<IWeeklyHarvestPlan> & { id: number; block: number }): IWeeklyHarvestPlan {
  return {
    block_code: `B${over.block}`,
    block_name: `Plan block ${over.block}`,
    block_manager_names: ['Aman'],
    late_edit_active: false,
    ...over,
  } as IWeeklyHarvestPlan;
}

describe('buildPlanGridRows', () => {
  it('lists every plannable block even when the week has no plans yet', () => {
    // The whole point of create-on-write: an uninitialised week still shows
    // rows to type into, instead of an empty table and an Initialize button.
    const rows = buildPlanGridRows(
      [block({ id: 1, code: 'A' }), block({ id: 2, code: 'B' })],
      [],
    );

    expect(rows.map((r) => r.block)).toEqual([1, 2]);
    expect(rows.every((r) => r.plan === null)).toBe(true);
  });

  it('attaches the plan, its manager names and late-edit state when one exists', () => {
    const rows = buildPlanGridRows(
      [block({ id: 1, code: 'A' })],
      [plan({ id: 50, block: 1, block_manager_names: ['Aman', 'Merdan'], late_edit_active: true })],
    );

    expect(rows[0].plan?.id).toBe(50);
    expect(rows[0].block_manager_names).toEqual(['Aman', 'Merdan']);
    expect(rows[0].late_edit_active).toBe(true);
  });

  it('carries the location for grouping and display', () => {
    const rows = buildPlanGridRows(
      [block({ id: 1, code: 'A', location: 3, location_name: 'Dusak' })],
      [],
    );

    expect(rows[0].location).toBe(3);
    expect(rows[0].location_name).toBe('Dusak');
  });

  it('drops sub-blocks, which the server refuses to plan', () => {
    const rows = buildPlanGridRows(
      [block({ id: 1, code: 'F' }), block({ id: 2, code: 'F1', parent: 1 })],
      [],
    );

    expect(rows.map((r) => r.block_code)).toEqual(['F']);
  });

  it('drops an inactive block with no plan, but keeps one whose week has a plan', () => {
    // Retiring a block mid-season must not make its recorded plan disappear.
    const rows = buildPlanGridRows(
      [
        block({ id: 1, code: 'A', is_active: false }),
        block({ id: 2, code: 'B', is_active: false }),
      ],
      [plan({ id: 60, block: 2 })],
    );

    expect(rows.map((r) => r.block)).toEqual([2]);
  });

  it('keeps a plan whose block is missing from the list, sorted last', () => {
    const rows = buildPlanGridRows(
      [block({ id: 1, code: 'Z', sort_order: 9 })],
      [plan({ id: 70, block: 99, block_code: 'GONE' })],
    );

    expect(rows.map((r) => r.block_code)).toEqual(['Z', 'GONE']);
    expect(rows[1].plan?.id).toBe(70);
  });

  it('orders by sort_order, then code', () => {
    const rows = buildPlanGridRows(
      [
        block({ id: 1, code: 'C', sort_order: 2 }),
        block({ id: 2, code: 'B', sort_order: 1 }),
        block({ id: 3, code: 'A', sort_order: 2 }),
      ],
      [],
    );

    expect(rows.map((r) => r.block_code)).toEqual(['B', 'A', 'C']);
  });

  it('falls back to the code when a block has no name', () => {
    const rows = buildPlanGridRows([block({ id: 1, code: 'Q', name: null })], []);

    expect(rows[0].block_name).toBe('Q');
  });
});
