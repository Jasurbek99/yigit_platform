import { describe, it, expect } from 'vitest';
import { normalizePlate, plateMatches } from './plateSearch';

describe('plate search', () => {
  it('ignores case, spaces and dashes', () => {
    expect(normalizePlate(' 1535 akm-2 ')).toBe('1535AKM2');
  });

  it('folds Cyrillic look-alikes typed on a Russian keyboard', () => {
    expect(plateMatches('1535 акм', '1535AKM/2256TAH')).toBe(true);
    expect(plateMatches('ВЕНОРСТХ', 'BEHOPCTX')).toBe(true);
  });

  it('matches either plate and treats an empty query as a match', () => {
    expect(plateMatches('2256', '1535AKM', '2256TAH')).toBe(true);
    expect(plateMatches('9999', '1535AKM', null)).toBe(false);
    expect(plateMatches('', null)).toBe(true);
  });
});
