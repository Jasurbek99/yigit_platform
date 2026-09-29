import { describe, it, expect } from 'vitest';
import type { IShipmentDraft } from '@/types';
import { decideBoardAction, nextSelection, pruneSelection, splitBoardColumns } from './boardHelpers';

function row(id: number, over: Partial<IShipmentDraft> = {}): IShipmentDraft {
  return {
    id, shipment_code: `C${id}`, date: '2026-09-29', created_at: '2026-09-29T06:00:00Z',
    created_by_name: null, weight_net: null, block_sources: [], export_code: null,
    previous_platform_id: null, harvest_age_days: 0, freshness: 'today', variety_confidence: 'none',
    status_code: 'draft', country: null, customer: null, ...over,
  };
}
const block = [{ block_id: 1, block_code: 'A', weight_kg: 9000 }];
const free = row(1, { block_sources: block });
const waiting = row(2, { status_code: 'gumruk_girish', country: 5, customer: 6 });
const joined = row(3, { status_code: 'gumruk_chykysh', country: 5, customer: 6, block_sources: block });
const loading = row(4, { status_code: 'yuklenme', country: 5, customer: 6, block_sources: block });
const bare = row(5);

describe('splitBoardColumns', () => {
  it('sorts rows into free / waiting / joined and drops the rest', () => {
    const cols = splitBoardColumns([free, waiting, joined, loading, bare]);
    expect(cols.free.map((r) => r.id)).toEqual([1]);
    expect(cols.waiting.map((r) => r.id)).toEqual([2]);
    expect(cols.joined.map((r) => r.id)).toEqual([3]);
  });
});

describe('decideBoardAction', () => {
  it('free packing + waiting export part → join, either order', () => {
    expect(decideBoardAction([free, waiting])).toEqual({ kind: 'join', targetId: 2, sourceId: 1 });
    expect(decideBoardAction([waiting, free])).toEqual({ kind: 'join', targetId: 2, sourceId: 1 });
  });
  it('one export part with packing → unjoin', () => {
    expect(decideBoardAction([joined])).toEqual({ kind: 'unjoin', id: 3 });
  });
  it('two rows with packing → swap (incl. a free supply plan)', () => {
    expect(decideBoardAction([joined, free])).toEqual({ kind: 'swap', aId: 3, bId: 1 });
  });
  it('nothing sensible → none', () => {
    expect(decideBoardAction([])).toEqual({ kind: 'none' });
    expect(decideBoardAction([free])).toEqual({ kind: 'none' });
    expect(decideBoardAction([waiting])).toEqual({ kind: 'none' });
    expect(decideBoardAction([waiting, waiting])).toEqual({ kind: 'none' });
    expect(decideBoardAction([joined, loading])).toEqual({ kind: 'none' });
  });
});

describe('nextSelection', () => {
  it('toggles, and a third pick starts over', () => {
    expect(nextSelection([], 1)).toEqual([1]);
    expect(nextSelection([1], 2)).toEqual([1, 2]);
    expect(nextSelection([1, 2], 2)).toEqual([1]);
    expect(nextSelection([1, 2], 3)).toEqual([3]);
  });
});

describe('pruneSelection', () => {
  it('drops an id whose row is no longer on the board, keeping pick order', () => {
    expect(pruneSelection([2, 9, 1], [free, waiting])).toEqual([2, 1]);
  });
  it('an empty board drops every id', () => {
    expect(pruneSelection([1, 2], [])).toEqual([]);
  });
});
