import { describe, it, expect } from 'vitest';
import { drfFieldErrors, formFieldErrors, httpStatus } from './drfErrors';

const fieldError = { response: { status: 400, data: { username: ['taken'], password: 'weak' } } };

describe('drfErrors', () => {
  it('reads the HTTP status, undefined without a response', () => {
    expect(httpStatus({ response: { status: 401 } })).toBe(401);
    expect(httpStatus(new Error('offline'))).toBeUndefined();
    expect(httpStatus(null)).toBeUndefined();
  });

  it('normalizes every body key to a list of messages', () => {
    expect(drfFieldErrors(fieldError)).toEqual({ username: ['taken'], password: ['weak'] });
    expect(drfFieldErrors({ response: { status: 403, data: { error: 'no' } } })).toEqual({ error: ['no'] });
    expect(drfFieldErrors({ response: { status: 500, data: '<html>' } })).toBeNull();
    expect(drfFieldErrors(new Error('offline'))).toBeNull();
  });

  it('keeps only the fields the form owns', () => {
    const isUsername = (name: string): name is 'username' => name === 'username';
    expect(formFieldErrors(fieldError, isUsername)).toEqual([{ name: 'username', errors: ['taken'] }]);
    expect(formFieldErrors(new Error('offline'), isUsername)).toEqual([]);
  });
});
