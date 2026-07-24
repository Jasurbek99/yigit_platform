/**
 * Sera Bütçe — Gübre (fertilizer) page mock data.
 *
 * Figures transcribed from the source "Gübre" screen (need / stock / purchase
 * planning + standard consumption-rate + kg/amount roll-up tables). UI-only
 * prototype — no API, no recompute across sections beyond simple arithmetic
 * (need cost, purchase cost, remaining stock) that the source screen itself
 * shows as live-derived columns.
 */

export const GUBRE_PRODUCT_TYPES: readonly string[] = [
  'Domates', 'HYYRA', 'hyyar', 'ggfggf', 'Alma', 'sdss', 'dfdf',
];

export interface GubreMaterial {
  readonly name: string;
  readonly isNew?: boolean;
  /** İhtiyaç (kap) — required quantity for the selected block/month scope. */
  readonly ihtiyacKap: number;
  /** Depo Stok (kap) — shared stock pool across all product types. */
  readonly depoStokKap: number;
  /** Birim Fiyat ($) — kept per product type on the source screen; this prototype uses one shared value. */
  readonly birimFiyatUsd: number;
}

export const GUBRE_MATERIALS: readonly GubreMaterial[] = [
  { name: 'Demir', ihtiyacKap: 2962, depoStokKap: 5000, birimFiyatUsd: 3 },
  { name: 'Kalsiyum Nitrat', ihtiyacKap: 372, depoStokKap: 2000, birimFiyatUsd: 3 },
  { name: 'Kalsiyum Klorür', ihtiyacKap: 496, depoStokKap: 2000, birimFiyatUsd: 2 },
  { name: 'Magnezyum Sülfat', ihtiyacKap: 0, depoStokKap: 2000, birimFiyatUsd: 2 },
  { name: 'MKP', ihtiyacKap: 0, depoStokKap: 0, birimFiyatUsd: 11 },
  { name: 'Potasyum Nitrat', ihtiyacKap: 0, depoStokKap: 0, birimFiyatUsd: 7 },
  { name: 'Potasyum Sülfat', ihtiyacKap: 0, depoStokKap: 0, birimFiyatUsd: 7 },
  { name: 'ssds', isNew: true, ihtiyacKap: 0, depoStokKap: 0, birimFiyatUsd: 0 },
  { name: 'dssd', isNew: true, ihtiyacKap: 0, depoStokKap: 0, birimFiyatUsd: 0 },
  { name: 'hyray dokun', isNew: true, ihtiyacKap: 0, depoStokKap: 3, birimFiyatUsd: 0 },
];

/** GA Başına Standart Sarf Oranı (kg/GA/ay) — cooled ("Soğutmalı") rows, 12 months. */
export const GUBRE_RATE_COOLED: Readonly<Record<string, readonly number[]>> = {
  'Demir': [13, 3, 3, 3, 3, 5, 2, 0, 0, 0, 0, 0],
  'Kalsiyum Nitrat': [3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Kalsiyum Klorür': [4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Magnezyum Sülfat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'MKP': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Potasyum Nitrat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Potasyum Sülfat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'ssds': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'dssd': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'hyray dokun': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/**
 * Uncooled ("Soğutmasız") rate rows — the source screenshot only captured the
 * "Soğutmalı" tab in its active state; no uncooled figures were visible to
 * transcribe, so this side is a zero placeholder (documented in the build report).
 */
export const GUBRE_RATE_UNCOOLED: Readonly<Record<string, readonly number[]>> = {
  'Demir': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Kalsiyum Nitrat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Kalsiyum Klorür': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Magnezyum Sülfat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'MKP': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Potasyum Nitrat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Potasyum Sülfat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'ssds': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'dssd': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'hyray dokun': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** Gübre Sarfı (kg) — computed roll-up, cooled scope. `null` cell = "—" (no consumption that month). */
export const GUBRE_KG_COOLED: Readonly<Record<string, readonly (number | null)[]>> = {
  'Demir': [1612, 372, 372, 372, 372, 620, 248, null, null, null, null, null],
  'Kalsiyum Nitrat': [372, 372, null, null, null, null, null, null, null, null, null, null],
  'Kalsiyum Klorür': [496, 248, null, null, null, null, null, null, null, null, null, null],
  'Magnezyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'MKP': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Nitrat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'ssds': [null, null, null, null, null, null, null, null, null, null, null, null],
  'dssd': [null, null, null, null, null, null, null, null, null, null, null, null],
  'hyray dokun': [null, null, null, null, null, null, null, null, null, null, null, null],
};

export const GUBRE_KG_UNCOOLED: Readonly<Record<string, readonly (number | null)[]>> = {
  'Demir': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Kalsiyum Nitrat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Kalsiyum Klorür': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Magnezyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'MKP': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Nitrat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'ssds': [null, null, null, null, null, null, null, null, null, null, null, null],
  'dssd': [null, null, null, null, null, null, null, null, null, null, null, null],
  'hyray dokun': [null, null, null, null, null, null, null, null, null, null, null, null],
};

/** Gübre Sarfı (Tutar) — kg × birim fiyat (Domates), cooled scope. */
export const GUBRE_AMT_COOLED: Readonly<Record<string, readonly (number | null)[]>> = {
  'Demir': [4836, 1116, 1116, 1116, 1116, 1860, 744, null, null, null, null, null],
  'Kalsiyum Nitrat': [1116, 1116, null, null, null, null, null, null, null, null, null, null],
  'Kalsiyum Klorür': [992, 496, null, null, null, null, null, null, null, null, null, null],
  'Magnezyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'MKP': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Nitrat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'ssds': [null, null, null, null, null, null, null, null, null, null, null, null],
  'dssd': [null, null, null, null, null, null, null, null, null, null, null, null],
  'hyray dokun': [null, null, null, null, null, null, null, null, null, null, null, null],
};

export const GUBRE_AMT_UNCOOLED: Readonly<Record<string, readonly (number | null)[]>> = {
  'Demir': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Kalsiyum Nitrat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Kalsiyum Klorür': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Magnezyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'MKP': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Nitrat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'Potasyum Sülfat': [null, null, null, null, null, null, null, null, null, null, null, null],
  'ssds': [null, null, null, null, null, null, null, null, null, null, null, null],
  'dssd': [null, null, null, null, null, null, null, null, null, null, null, null],
  'hyray dokun': [null, null, null, null, null, null, null, null, null, null, null, null],
};
