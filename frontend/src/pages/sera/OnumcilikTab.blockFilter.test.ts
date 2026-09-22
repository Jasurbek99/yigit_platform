import { describe, it, expect } from 'vitest';
import { filterPlansByBlock, groupBlockFilterOptions } from './OnumcilikTab.blockFilter';

function plan(block: number) {
  return { block };
}

describe('filterPlansByBlock', () => {
  it('returns every plan unchanged when the selection is null (no filter)', () => {
    const plans = [plan(1), plan(2), plan(3)];

    expect(filterPlansByBlock(plans, null)).toBe(plans);
  });

  it('keeps only the rows whose block id is selected', () => {
    const plans = [plan(1), plan(2), plan(3)];

    expect(filterPlansByBlock(plans, [1, 3])).toEqual([plan(1), plan(3)]);
  });

  it('preserves row order rather than the order of the selection', () => {
    const plans = [plan(1), plan(2), plan(3)];

    expect(filterPlansByBlock(plans, [3, 1])).toEqual([plan(1), plan(3)]);
  });

  it('returns an empty array for an explicit empty selection', () => {
    // The UI wrapper never actually passes [] (it maps an empty pick back to
    // `null` — see BlockFilterSelect), but the pure fn stays total either way:
    // an empty *selection* is a real "show nothing" input, distinct from the
    // `null` "no filter" sentinel.
    const plans = [plan(1), plan(2)];

    expect(filterPlansByBlock(plans, [])).toEqual([]);
  });

  it('ignores selected ids that match no row', () => {
    const plans = [plan(1), plan(2)];

    expect(filterPlansByBlock(plans, [1, 99])).toEqual([plan(1)]);
  });
});

function row(block: number, block_name: string, location_name: string | null) {
  return { block, block_name, block_code: `B${block}`, location_name };
}

describe('groupBlockFilterOptions', () => {
  it('groups blocks under their location name', () => {
    const rows = [row(1, 'Block A', 'Dusak'), row(2, 'Block B', 'Kaka'), row(3, 'Block C', 'Dusak')];

    const groups = groupBlockFilterOptions(rows, 'No location');

    expect(groups).toEqual([
      { label: 'Dusak', options: [{ value: 1, label: 'Block A' }, { value: 3, label: 'Block C' }] },
      { label: 'Kaka', options: [{ value: 2, label: 'Block B' }] },
    ]);
  });

  it('orders groups alphabetically by location name', () => {
    const rows = [row(1, 'Block A', 'Owadandepe'), row(2, 'Block B', 'Dusak'), row(3, 'Block C', 'Kaka')];

    const groups = groupBlockFilterOptions(rows, 'No location');

    expect(groups.map((g) => g.label)).toEqual(['Dusak', 'Kaka', 'Owadandepe']);
  });

  it('collects blocks with no location into one final group, alphabetical order notwithstanding', () => {
    const rows = [row(1, 'Block A', null), row(2, 'Block B', 'Ankara'), row(3, 'Block C', null)];

    const groups = groupBlockFilterOptions(rows, 'No location');

    expect(groups.map((g) => g.label)).toEqual(['Ankara', 'No location']);
    expect(groups[1].options).toEqual([
      { value: 1, label: 'Block A' },
      { value: 3, label: 'Block C' },
    ]);
  });

  it('omits the no-location group entirely when every block has one', () => {
    const rows = [row(1, 'Block A', 'Dusak')];

    const groups = groupBlockFilterOptions(rows, 'No location');

    expect(groups.map((g) => g.label)).toEqual(['Dusak']);
  });

  it('falls back to the block code when the name is blank', () => {
    const rows = [row(1, '', 'Dusak')];

    const groups = groupBlockFilterOptions(rows, 'No location');

    expect(groups[0].options).toEqual([{ value: 1, label: 'B1' }]);
  });

  it('returns an empty array for no rows', () => {
    expect(groupBlockFilterOptions([], 'No location')).toEqual([]);
  });
});
