import { describe, it, expect } from 'vitest';
import {
  isDestinationDraft,
  isSupplyDraft,
  detectJoinDirection,
  explainJoinBlockers,
  canUserJoin,
  type IJoinClassifiable,
} from './joinHelpers';
import { useSheetStore } from '@/stores/sheetStore';

describe('join classifiers accept the structural shape', () => {
  const destination = { status_code: 'draft', country: 1, customer: 2, block_sources: [] };
  const supply = { status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 5 }] };

  it('classifies a destination draft', () => {
    expect(isDestinationDraft(destination)).toBe(true);
    expect(isSupplyDraft(destination)).toBe(false);
  });
  it('classifies a supply draft', () => {
    expect(isSupplyDraft(supply)).toBe(true);
    expect(isDestinationDraft(supply)).toBe(false);
  });
  it('a non-draft is neither', () => {
    expect(isDestinationDraft({ ...destination, status_code: 'yuklenme' })).toBe(false);
  });
});

describe('detectJoinDirection', () => {
  const destination: IJoinClassifiable = { status_code: 'draft', country: 1, customer: 2, block_sources: [] };
  const supply: IJoinClassifiable = { status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 5 }] };

  it('detects target=destination, source=supply regardless of argument order', () => {
    expect(detectJoinDirection(destination, supply)).toEqual({ target: destination, source: supply });
    expect(detectJoinDirection(supply, destination)).toEqual({ target: destination, source: supply });
  });
  it('two supplies → ambiguous', () => {
    const supply2: IJoinClassifiable = { status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 7 }] };
    expect(detectJoinDirection(supply, supply2)).toEqual({ error: 'ambiguous' });
  });
  it('two destinations → ambiguous', () => {
    const dest2: IJoinClassifiable = { status_code: 'draft', country: 3, customer: 4, block_sources: [] };
    expect(detectJoinDirection(destination, dest2)).toEqual({ error: 'ambiguous' });
  });
  it('destination + empty draft (no blocks, no country) → ambiguous', () => {
    const empty: IJoinClassifiable = { status_code: 'draft', country: null, customer: null, block_sources: [] };
    expect(detectJoinDirection(destination, empty)).toEqual({ error: 'ambiguous' });
  });
});

describe('canUserJoin mirrors the backend gate', () => {
  it.each(['admin', 'export_manager', 'director', 'boss'])('allows %s', (role) => {
    expect(canUserJoin({ role, is_superuser: false })).toBe(true);
  });
  it('allows a superuser whatever the role', () => {
    expect(canUserJoin({ role: 'loading_dept_head', is_superuser: true })).toBe(true);
  });
  it.each(['loading_dept_head', 'warehouse_chief', 'agronom'])('denies %s', (role) => {
    expect(canUserJoin({ role, is_superuser: false })).toBe(false);
  });
  it('denies a missing user', () => {
    expect(canUserJoin(null)).toBe(false);
  });
});

describe('isSupplyDraft matches the backend rule (blocks only)', () => {
  it('accepts a blocked draft that already has a country/customer', () => {
    expect(
      isSupplyDraft({
        status_code: 'draft',
        country: 1,
        customer: 2,
        block_sources: [{ block_id: 5 }],
        created_by_role: 'export_manager',
      }),
    ).toBe(true);
  });
});

describe('explainJoinBlockers', () => {
  const dest = { status_code: 'draft', country: 1, customer: 2, block_sources: [], shipment_code: 'D-1' };
  const supply = { status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 5 }], shipment_code: 'S-1' };

  it('returns [] for a joinable pair', () => {
    expect(explainJoinBlockers([dest, supply])).toEqual([]);
  });
  it('asks for two when the selection is short', () => {
    expect(explainJoinBlockers([dest])).toEqual([{ key: 'need_two' }]);
  });
  it('flags a non-draft by code', () => {
    expect(explainJoinBlockers([{ ...dest, status_code: 'yuklenme' }, supply])).toEqual([
      { key: 'not_draft', code: 'D-1' },
    ]);
  });
  it('flags two supplies', () => {
    expect(explainJoinBlockers([supply, { ...supply, shipment_code: 'S-2' }])).toEqual([
      { key: 'both_supply' },
    ]);
  });
  it('flags no supply at all', () => {
    expect(explainJoinBlockers([dest, { ...dest, shipment_code: 'D-2' }])).toEqual([
      { key: 'no_supply' },
    ]);
  });
  it('names the empty destination fields on the target column', () => {
    const bare = { ...dest, country: null, customer: null, shipment_code: 'D-9' };
    expect(explainJoinBlockers([bare, supply])).toEqual([
      { key: 'target_no_country', code: 'D-9' },
      { key: 'target_no_customer', code: 'D-9' },
    ]);
  });
  it('names only the missing one', () => {
    expect(explainJoinBlockers([{ ...dest, customer: null }, supply])).toEqual([
      { key: 'target_no_customer', code: 'D-1' },
    ]);
  });
  it('rejects the same column twice', () => {
    expect(explainJoinBlockers([dest, dest])).toEqual([{ key: 'same_shipment' }]);
  });
});

describe('join selection is a sliding window of two', () => {
  it('a third click replaces the oldest pick instead of being ignored', () => {
    useSheetStore.setState({ joinMode: true, joinSelection: [] });
    const { toggleJoinSelection } = useSheetStore.getState();
    toggleJoinSelection(1);
    toggleJoinSelection(2);
    expect(useSheetStore.getState().joinSelection).toEqual([1, 2]);
    toggleJoinSelection(3);
    expect(useSheetStore.getState().joinSelection).toEqual([2, 3]);
  });
  it('clicking a selected column still deselects it', () => {
    useSheetStore.setState({ joinMode: true, joinSelection: [] });
    const { toggleJoinSelection } = useSheetStore.getState();
    toggleJoinSelection(1);
    toggleJoinSelection(2);
    toggleJoinSelection(1);
    expect(useSheetStore.getState().joinSelection).toEqual([2]);
  });
});
