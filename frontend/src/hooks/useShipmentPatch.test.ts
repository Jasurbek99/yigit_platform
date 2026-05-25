import { describe, it, expect } from 'vitest';
import type { AxiosError } from 'axios';
import { extractPatchError, mergeServerScalars } from './useShipmentPatch';

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
