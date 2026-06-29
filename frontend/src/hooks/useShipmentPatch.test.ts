import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import {
  extractPatchError,
  mergeServerScalars,
  applyOptimistic,
  reconcileFromServer,
} from './useShipmentPatch';

// Synthetic AxiosError builder — keeps tests focused on extractPatchError's
// branching without pulling in a full axios mock.
function fakeAxiosError(parts: Partial<AxiosError<unknown>>): AxiosError<unknown> {
  return parts as AxiosError<unknown>;
}

describe('extractPatchError', () => {
  it('returns response.data.error when present', () => {
    const err = fakeAxiosError({
      response: { data: { error: 'Role cannot edit this field.' } } as AxiosError['response'],
    });
    expect(extractPatchError(err, 'fallback')).toBe('Role cannot edit this field.');
  });

  it('returns DRF field error in "field: message" shape', () => {
    const err = fakeAxiosError({
      response: {
        data: { weight_net: ['This field is required.'] },
      } as AxiosError['response'],
    });
    expect(extractPatchError(err, 'fallback')).toBe('weight_net: This field is required.');
  });

  it('returns status + statusText when no body error present', () => {
    const err = fakeAxiosError({
      response: { status: 403, statusText: 'Forbidden', data: {} } as AxiosError['response'],
    });
    expect(extractPatchError(err, 'Save failed')).toBe('Save failed (403 Forbidden)');
  });

  it('returns fallback combined with error message when no response', () => {
    const err = fakeAxiosError({ message: 'Network Error' });
    expect(extractPatchError(err, 'Save failed')).toBe('Save failed — Network Error');
  });

  it('returns plain fallback when no signals at all', () => {
    const err = fakeAxiosError({});
    expect(extractPatchError(err, 'fallback')).toBe('fallback');
  });
});

describe('mergeServerScalars', () => {
  it('overrides scalar values the server echoed back', () => {
    const row = { id: 1, status: 2, status_display: 'Loading', weight_net: 100 };
    const server = { id: 1, status: 3, status_display: 'Departed', weight_net: 18500 };
    expect(mergeServerScalars(row, server)).toEqual({
      id: 1,
      status: 3,
      status_display: 'Departed',
      weight_net: 18500,
    });
  });

  it('takes null from the server (a real cleared value, not "absent")', () => {
    const row = { id: 1, arrived_at: '2025-02-01T00:00:00+05:00' };
    const server = { id: 1, arrived_at: null };
    expect(mergeServerScalars(row, server).arrived_at).toBeNull();
  });

  it('skips object/array values whose detail shape differs from the sheet shape', () => {
    const firmSplits = [{ firm_code: 'YGT', weight_kg: 100 }];
    const row = { id: 1, firm_splits: firmSplits, weight_net: 100 };
    // Server (detail serializer) returns a different firm_splits shape — must be ignored.
    const server = {
      id: 1,
      firm_splits: [{ export_firm_id: 7, export_firm_name: 'YGT', weight_kg: 100 }],
      quality: { azyk_maglumatnama: true },
      weight_net: 200,
    };
    const result = mergeServerScalars(row, server);
    expect(result.firm_splits).toBe(firmSplits); // same reference — untouched
    expect(result.weight_net).toBe(200); // scalar still folded in
    expect('quality' in result).toBe(false); // detail-only key not introduced
  });

  it('ignores server keys absent from the cached row', () => {
    const row = { id: 1, weight_net: 100 };
    const server = { id: 1, weight_net: 200, detail_only_field: 'x' };
    const result = mergeServerScalars(row, server) as Record<string, unknown>;
    expect(result.weight_net).toBe(200);
    expect('detail_only_field' in result).toBe(false);
  });

  it('leaves a row field untouched when the server omits it', () => {
    const row = { id: 1, status_step: 5, weight_net: 100 };
    const server = { id: 1, weight_net: 200 }; // no status_step echoed
    expect(mergeServerScalars(row, server).status_step).toBe(5);
  });
});

// Regression: the task-modal drawer reads the single-shipment sheet cache
// `['shipments','sheet','row',id]`. Before the fix the cache helpers only
// touched the full-season `['shipments','sheet']`, so each saved driver field
// reverted to its stale value when its editor closed — typing the next field
// made the previous one "disappear".
describe('drawer single-shipment cache (task modal field edits)', () => {
  const ROW_KEY = ['shipments', 'sheet', 'row', 5] as const;

  function seed() {
    const qc = new QueryClient();
    qc.setQueryData(ROW_KEY, {
      shipments: [{ id: 5, driver_name: '', driver_phone: null, truck_plate: null }],
      rows: [],
      row_settings: {},
    });
    return qc;
  }

  function row(qc: QueryClient) {
    const data = qc.getQueryData<{ shipments: Record<string, unknown>[] }>(ROW_KEY);
    return data?.shipments.find((s) => s.id === 5);
  }

  it('applyOptimistic writes the edited field into the drawer row cache', () => {
    const qc = seed();
    applyOptimistic(qc, 5, { driver_name: 'Ali' });
    expect(row(qc)?.driver_name).toBe('Ali');
  });

  it('a second field edit does not wipe the first (the reported bug)', () => {
    const qc = seed();
    applyOptimistic(qc, 5, { driver_name: 'Ali' });
    applyOptimistic(qc, 5, { driver_phone: '+99312' });
    expect(row(qc)?.driver_name).toBe('Ali'); // still there
    expect(row(qc)?.driver_phone).toBe('+99312');
  });

  it('reconcileFromServer folds server scalars into the drawer row cache', () => {
    const qc = seed();
    applyOptimistic(qc, 5, { truck_plate: '29 AT 580' });
    reconcileFromServer(qc, 5, { id: 5, truck_plate: '29 AT 580', driver_name: 'Ali' });
    expect(row(qc)?.truck_plate).toBe('29 AT 580');
    expect(row(qc)?.driver_name).toBe('Ali');
  });

  it('does not create a phantom row cache entry when none exists', () => {
    const qc = new QueryClient(); // nothing seeded
    applyOptimistic(qc, 5, { driver_name: 'Ali' });
    expect(qc.getQueryData(ROW_KEY)).toBeUndefined();
  });
});
