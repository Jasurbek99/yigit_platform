import { describe, it, expect } from 'vitest';
import { pickMenuComposition } from './menuComposition';

describe('pickMenuComposition', () => {
  it('returns the boss value when isBoss is true', () => {
    expect(pickMenuComposition(true, 'BOSS', 'STAFF')).toBe('BOSS');
  });

  it('returns the staff value when isBoss is false', () => {
    expect(pickMenuComposition(false, 'BOSS', 'STAFF')).toBe('STAFF');
  });

  it('returns the exact same object reference for the chosen branch, not a copy', () => {
    const boss = { label: 'boss-array' };
    const staff = { label: 'staff-array' };
    expect(pickMenuComposition(true, boss, staff)).toBe(boss);
    expect(pickMenuComposition(false, boss, staff)).toBe(staff);
  });
});
