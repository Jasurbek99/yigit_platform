import { describe, it, expect } from 'vitest';
import { cellMode, lockReasonKey, saveErrorKey } from './LocalSellPlanGrid.cells';
import type { ICellState } from './LocalSellPlanGrid.cells';

function state(over: Partial<ICellState> = {}): ICellState {
  return { status: 'draft', value: 0, canEdit: true, isApprover: false, ...over };
}

describe('cellMode', () => {
  it('lets a writer edit any day of a draft', () => {
    expect(cellMode(state({ status: 'draft', value: 0 }))).toBe('edit');
    expect(cellMode(state({ status: 'draft', value: 500 }))).toBe('edit');
  });

  it('lets a writer edit a rejected plan so it can be corrected and re-sent', () => {
    expect(cellMode(state({ status: 'rejected', value: 500 }))).toBe('edit');
  });

  it('keeps an empty day editable after the week is sent (fill-empties)', () => {
    expect(cellMode(state({ status: 'submitted', value: 0 }))).toBe('edit');
  });

  it('locks a filled day after the week is sent', () => {
    expect(cellMode(state({ status: 'submitted', value: 500 }))).toBe('locked');
  });

  it('offers an approver the double-click override on a filled sent day', () => {
    expect(cellMode(state({ status: 'submitted', value: 500, isApprover: true })))
      .toBe('unlockable');
  });

  it('locks an approved plan for a writer', () => {
    expect(cellMode(state({ status: 'approved', value: 500 }))).toBe('locked');
  });

  it('locks an approved plan for an approver too — no override path', () => {
    expect(cellMode(state({ status: 'approved', value: 500, isApprover: true })))
      .toBe('locked');
  });

  it('locks an approved EMPTY day as well — approved freezes the whole row', () => {
    expect(cellMode(state({ status: 'approved', value: 0, isApprover: true })))
      .toBe('locked');
  });

  it('locks everything for a reader (no write role, or closed season)', () => {
    expect(cellMode(state({ status: 'draft', canEdit: false }))).toBe('locked');
    expect(cellMode(state({ status: 'submitted', value: 0, canEdit: false }))).toBe('locked');
  });

  it('treats 0 as empty, matching the backend `> 0` predicate exactly', () => {
    // The backend locks `getattr(plan, f) > 0`; anything at or below 0 is empty.
    expect(cellMode(state({ status: 'submitted', value: 0 }))).toBe('edit');
    expect(cellMode(state({ status: 'submitted', value: 0.5 }))).toBe('locked');
  });
});

describe('lockReasonKey', () => {
  it('names approval as the reason on an approved plan', () => {
    expect(lockReasonKey({ status: 'approved', canEdit: true }))
      .toBe('local_sell.locked_approved');
  });

  it('names the send as the reason on a submitted plan', () => {
    expect(lockReasonKey({ status: 'submitted', canEdit: true }))
      .toBe('local_sell.locked_after_submit');
  });

  it('names the missing permission when the user cannot write at all', () => {
    expect(lockReasonKey({ status: 'draft', canEdit: false }))
      .toBe('local_sell.locked_no_edit');
  });

  it('puts approval ahead of permission — the row is frozen for everyone', () => {
    expect(lockReasonKey({ status: 'approved', canEdit: false }))
      .toBe('local_sell.locked_approved');
  });
});

describe('saveErrorKey', () => {
  it('distinguishes the two lock 409s', () => {
    expect(saveErrorKey({ error: 'plan_approved_locked' }))
      .toBe('local_sell.locked_approved');
    expect(saveErrorKey({ error: 'cell_locked_after_submit' }))
      .toBe('local_sell.locked_after_submit');
  });

  it('does not blame the lock for a closed-season 409', () => {
    // Same endpoint, same status code, different person to ask.
    expect(saveErrorKey({ error: 'season_closed', season: '2025/2026' }))
      .toBe('local_sell.save_season_closed');
  });

  it('falls back to the generic failure for anything else', () => {
    expect(saveErrorKey(undefined)).toBe('local_sell.save_error');
    expect(saveErrorKey({ detail: 'boom' })).toBe('local_sell.save_error');
  });
});
