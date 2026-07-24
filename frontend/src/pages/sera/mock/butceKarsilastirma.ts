/**
 * Býudjet Deňeşdirme — Girdeji (Bütçe Karşılaştırma) — page-specific mock data.
 *
 * Plan (Meýilleşdirilen — from the "Satuw" sales-plan screen) vs. Actual
 * (Hakyky — pulled from Logo Tiger) income comparison for Ocak (January)
 * 2026. Figures transcribed from the source "Sera Bütçe Yönetimi" app.
 * "Hakyky" is 0 everywhere for Ocak in the source data — no actuals have
 * been synced from Logo Tiger yet — so every variance is 100% "Kg Sebäpli".
 */

// ─── Country / channel level ────────────────────────────────────────────
export interface CountryCompareRow {
  readonly channel: string;
  readonly planKg: number;
  readonly actualKg: number;
  readonly planPriceUsd: number;
  readonly actualPriceUsd: number;
}

export const COUNTRY_COMPARE_OCAK: readonly CountryCompareRow[] = [
  { channel: 'Kazakistan', planKg: 2875492, actualKg: 0, planPriceUsd: 1.26, actualPriceUsd: 0 },
  { channel: 'Rusya', planKg: 1437746, actualKg: 0, planPriceUsd: 1.26, actualPriceUsd: 0 },
  { channel: 'Kapı Satışy', planKg: 1437746, actualKg: 0, planPriceUsd: 0.85, actualPriceUsd: 0 },
  { channel: 'Içerki Bazar', planKg: 784225, actualKg: 0, planPriceUsd: 5, actualPriceUsd: 0 },
];

// Plan revenue per channel (USD) — read directly from the source sales-plan
// screen (not simply planKg × planPriceUsd, since the unit price shown is a
// rounded display value). Used to derive the exact "Kg Sebäpli Tapawut".
export const COUNTRY_PLAN_REVENUE_USD: Readonly<Record<string, number>> = {
  'Kazakistan': 3615356,
  'Rusya': 1807678,
  'Kapı Satışy': 1222084,
  'Içerki Bazar': 3921126,
};

// ─── Block level ─────────────────────────────────────────────────────────
export interface BlockCompareRow {
  readonly name: string;
  readonly planKg: number;
  readonly actualKg: number;
  readonly planRevenueUsd: number;
  readonly actualRevenueUsd: number;
}

export const BLOCK_COMPARE_OCAK: readonly BlockCompareRow[] = [
  { name: 'Dusak A', planKg: 382725, actualKg: 0, planRevenueUsd: 618796, actualRevenueUsd: 0 },
  { name: 'Dusak B', planKg: 236417, actualKg: 0, planRevenueUsd: 382243, actualRevenueUsd: 0 },
  { name: 'Dusak C', planKg: 227333, actualKg: 0, planRevenueUsd: 367556, actualRevenueUsd: 0 },
  { name: 'Dusak 1', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 2', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 3', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 4', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 5', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 6', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 7', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 8', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 9', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Dusak 10', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Kaka D', planKg: 543662, actualKg: 0, planRevenueUsd: 879003, actualRevenueUsd: 0 },
  { name: 'Kaka E', planKg: 558026, actualKg: 0, planRevenueUsd: 902226, actualRevenueUsd: 0 },
  { name: 'Kaka F', planKg: 551817, actualKg: 0, planRevenueUsd: 892188, actualRevenueUsd: 0 },
  { name: 'Kaka G', planKg: 707387, actualKg: 0, planRevenueUsd: 1143716, actualRevenueUsd: 0 },
  { name: 'Kaka H', planKg: 402557, actualKg: 0, planRevenueUsd: 650861, actualRevenueUsd: 0 },
  { name: 'Kaka I', planKg: 565910, actualKg: 0, planRevenueUsd: 914973, actualRevenueUsd: 0 },
  { name: 'Kaka J', planKg: 265843, actualKg: 0, planRevenueUsd: 429820, actualRevenueUsd: 0 },
  { name: 'Kaka K', planKg: 618881, actualKg: 0, planRevenueUsd: 1000619, actualRevenueUsd: 0 },
  { name: 'Kaka L', planKg: 618881, actualKg: 0, planRevenueUsd: 1000619, actualRevenueUsd: 0 },
  { name: 'Kaka N', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Kaka P', planKg: 0, actualKg: 0, planRevenueUsd: 0, actualRevenueUsd: 0 },
  { name: 'Kaka M15', planKg: 303024, actualKg: 0, planRevenueUsd: 489935, actualRevenueUsd: 0 },
  { name: 'Kaka M5', planKg: 94651, actualKg: 0, planRevenueUsd: 153034, actualRevenueUsd: 0 },
  { name: 'Owadandepe O', planKg: 458095, actualKg: 0, planRevenueUsd: 740656, actualRevenueUsd: 0 },
];

export const BLOCK_COMPARE_TOTAL_PLAN_KG = BLOCK_COMPARE_OCAK.reduce((s, r) => s + r.planKg, 0);
export const BLOCK_COMPARE_TOTAL_PLAN_REVENUE_USD = BLOCK_COMPARE_OCAK.reduce((s, r) => s + r.planRevenueUsd, 0);
