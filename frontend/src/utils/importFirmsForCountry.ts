import type { IImportFirm } from '@/types';

/**
 * Active import firms of the shipment's destination country. No country yet →
 * every active firm. The currently selected firm always stays in the list so a
 * legacy cross-country pick still renders its name instead of a bare id.
 */
export function importFirmsForCountry(
  firms: readonly IImportFirm[],
  countryId: number | null | undefined,
  selectedId?: number | null,
): IImportFirm[] {
  return firms.filter(
    (f) => f.is_active && (countryId == null || f.country === countryId || f.id === selectedId),
  );
}
