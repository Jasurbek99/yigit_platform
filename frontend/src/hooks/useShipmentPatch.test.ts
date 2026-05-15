import { describe, it, expect } from 'vitest';
import type { AxiosError } from 'axios';
import { extractPatchError } from './useShipmentPatch';

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
