import { describe, it, expect } from 'vitest';
import { importFirmsForCountry } from './importFirmsForCountry';
import type { IImportFirm } from '@/types';

function firm(id: number, country: number | null, is_active = true): IImportFirm {
  return { id, country, is_active } as IImportFirm;
}

const FIRMS = [firm(1, 10), firm(2, 10), firm(3, 20), firm(4, 10, false)];

describe('importFirmsForCountry', () => {
  it('returns every active firm when the shipment has no country', () => {
    expect(importFirmsForCountry(FIRMS, null).map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it('keeps only the firms of the given country', () => {
    expect(importFirmsForCountry(FIRMS, 10).map((f) => f.id)).toEqual([1, 2]);
  });

  it('keeps the selected firm even when it is from another country', () => {
    expect(importFirmsForCountry(FIRMS, 10, 3).map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it('drops inactive firms', () => {
    expect(importFirmsForCountry(FIRMS, 10).some((f) => f.id === 4)).toBe(false);
  });
});
