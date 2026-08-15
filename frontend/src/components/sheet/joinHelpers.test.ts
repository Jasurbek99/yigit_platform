import { describe, it, expect } from 'vitest';
import { isDestinationDraft, isSupplyDraft, detectJoinDirection, type IJoinClassifiable } from './joinHelpers';

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
