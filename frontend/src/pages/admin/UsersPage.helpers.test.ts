import { describe, it, expect } from 'vitest';
import { resolveLoadingLocation } from './UsersPage.helpers';

describe('resolveLoadingLocation', () => {
  it('keeps the location for garawul', () => {
    expect(resolveLoadingLocation('garawul', 5)).toBe(5);
  });

  it('nulls the location for any other role, even if one was previously chosen', () => {
    // antd Form keeps an unmounted field's value (preserve: true) — a user who
    // picked garawul + a location, then switched to another role, must not
    // have that stale value leak into the payload.
    expect(resolveLoadingLocation('sales_rep', 5)).toBeNull();
  });

  it('nulls the location when garawul has none selected yet', () => {
    expect(resolveLoadingLocation('garawul', null)).toBeNull();
  });

  it('nulls the location when no role is set', () => {
    expect(resolveLoadingLocation(null, 5)).toBeNull();
  });
});
