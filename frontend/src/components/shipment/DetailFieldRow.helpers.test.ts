import { describe, it, expect } from 'vitest';
import { deriveSaveState } from './DetailFieldRow.helpers';

// The row must never silently return to "no feedback" after a successful
// save — "Saved" persists until the user edits again. NN/g: display the word
// Saved beside each field so the user knows no further action is required.
describe('deriveSaveState', () => {
  it('is idle before anything happens', () => {
    expect(deriveSaveState({ isPending: false, isError: false, hasSavedOnce: false }))
      .toBe('idle');
  });

  it('is pending while the request is in flight', () => {
    expect(deriveSaveState({ isPending: true, isError: false, hasSavedOnce: false }))
      .toBe('pending');
  });

  it('stays saved after a successful save', () => {
    expect(deriveSaveState({ isPending: false, isError: false, hasSavedOnce: true }))
      .toBe('saved');
  });

  it('reports error even when a previous save succeeded', () => {
    expect(deriveSaveState({ isPending: false, isError: true, hasSavedOnce: true }))
      .toBe('error');
  });

  it('pending wins over a stale error', () => {
    expect(deriveSaveState({ isPending: true, isError: true, hasSavedOnce: false }))
      .toBe('pending');
  });
});
