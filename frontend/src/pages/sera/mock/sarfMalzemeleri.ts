/**
 * Sarf Malzemeleri (consumables) — page-specific mock data.
 *
 * UI-only prototype. Figures transcribed from the source "Sera Bütçe
 * Yönetimi" app's Sarf Malzemeleri screen (product-type scoped standard
 * rates, per-block expense month, and unit prices).
 */

export const CONSUMABLE_PRODUCT_TYPES: readonly string[] = [
  'Domates', 'HYYRA', 'hyyar', 'ggfggf', 'Alma', 'sdss', 'dfdf',
];

export const CONSUMABLE_UNITS: readonly string[] = ['adet', 'litre', 'kg', 'ml', 'gram'];

export interface ConsumableMaterial {
  readonly key: string;
  readonly name: string;
  readonly unit: string;
  /** Standart oran per 1 GA (greenhouse area unit), for the active product type. */
  readonly standardQty: number;
  /** Default "Gider Ayı" month index (0 = Ocak) applied to every block. */
  readonly defaultGiderAyIdx: number;
  /** Unit price (USD) — used by the "Birim Fiyat & Tutar" tab. */
  readonly unitPriceUsd: number;
}

export const DEFAULT_CONSUMABLE_MATERIALS: readonly ConsumableMaterial[] = [
  { key: 'tohum', name: 'Tohum', unit: 'adet', standardQty: 98, defaultGiderAyIdx: 6, unitPriceUsd: 0 },
  { key: 'kokopeat', name: 'Kokopeat', unit: 'litre', standardQty: 100, defaultGiderAyIdx: 6, unitPriceUsd: 0 },
  { key: 'kubik', name: 'Kübik (Taş Yünü)', unit: 'adet', standardQty: 10, defaultGiderAyIdx: 6, unitPriceUsd: 0 },
  { key: 'ilac', name: 'İlaç', unit: 'ml', standardQty: 1, defaultGiderAyIdx: 6, unitPriceUsd: 0 },
];

/** Per-block "Gider Ayı" month-index overrides (source screenshot: Dusak B differs — Ağustos). */
export const GIDER_AYI_BLOCK_OVERRIDES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  tohum: { 'DUS-B': 7 },
  kokopeat: { 'DUS-B': 7 },
};
