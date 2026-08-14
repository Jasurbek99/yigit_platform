import { describe, it, expect } from 'vitest';
import { isDestinationDraft, isSupplyDraft } from './joinHelpers';

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
