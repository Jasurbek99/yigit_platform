export type WeightUnit = 'kg' | 'ton';

/** Convert a raw kg value for display in the selected unit. Input must always be in kg. */
export function displayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'ton' ? kg / 1000 : kg;
}

/** Format a raw kg value for display in the selected unit. Input must always be in kg. */
export function fmtWeight(kg: number, unit: WeightUnit): string {
  return displayWeight(kg, unit).toLocaleString('ru-RU', {
    maximumFractionDigits: unit === 'ton' ? 2 : 0,
  });
}

/** The label suffix for the current unit. */
export function weightSuffix(unit: WeightUnit): string {
  return unit === 'ton' ? 't' : 'kg';
}
