/**
 * Satış (Satyş) — page-specific mock data.
 *
 * Prices, sales-distribution %, and transport-loss % are per PRODUCT TYPE
 * (this page shows the Domates figures — the product type currently
 * selected in the "Ürün Türleri" chip row). Shared block/month lists live in
 * `mock/seraData.ts`; only the Satış-specific figures live here.
 */

import { MONTHS_TR } from './seraData';

// ─── Product types ───────────────────────────────────────────────────────
// "Domates" is the built-in default (cannot be renamed/deleted). The rest
// are user-defined product types in this prototype's source data.
export const PRODUCT_TYPES: readonly string[] = ['Domates', 'HYYRA', 'hyyar', 'ggfggf', 'Alma', 'sdss', 'dfdf'];

// ─── Block → product rotation defaults ──────────────────────────────────
// Blocks not listed here grow "Domates" all year with no rotation.
export interface BlockRotation {
  readonly fromMonth: string; // month the rotation switches away from Domates
  readonly toProduct: string;
}
export const DEFAULT_BLOCK_ROTATIONS: Record<string, BlockRotation> = {
  'DUS-A': { fromMonth: 'Temmuz', toProduct: 'hyyar' },
  'DUS-B': { fromMonth: 'Temmuz', toProduct: 'hyyar' },
  'DUS-C': { fromMonth: 'Temmuz', toProduct: 'hyyar' },
  'KAK-D': { fromMonth: 'Temmuz', toProduct: 'hyyar' },
  'KAK-M15': { fromMonth: 'Temmuz', toProduct: 'Domates' },
};

// ─── Monthly prices — Domates ────────────────────────────────────────────
export interface PriceRow {
  readonly month: string;
  readonly icPazarDtmKg: number;
  readonly kapiSatisiUsdKg: number;
  readonly kazakistanUsdKg: number;
  readonly rusyaUsdKg: number;
  readonly usdKuruDtm: number;
}
const PRICE_VALUES: readonly (readonly [number, number, number, number, number])[] = [
  [5, 0.85, 1.27, 1.27, 19.5],
  [5, 1.35, 1.8, 1.8, 19.5],
  [5, 1.48, 1.95, 1.95, 19.5],
  [5, 1, 1.42, 1.42, 19.5],
  [5, 0.45, 0.87, 0.87, 19.5],
  [2, 0.2, 0.62, 0.62, 19.5],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
];
export const PRICES_DOMATES: readonly PriceRow[] = MONTHS_TR.map((month, i) => ({
  month,
  icPazarDtmKg: PRICE_VALUES[i][0],
  kapiSatisiUsdKg: PRICE_VALUES[i][1],
  kazakistanUsdKg: PRICE_VALUES[i][2],
  rusyaUsdKg: PRICE_VALUES[i][3],
  usdKuruDtm: PRICE_VALUES[i][4],
}));

// ─── Monthly sales distribution (%) — Domates ───────────────────────────
export interface DistRow {
  readonly month: string;
  readonly icPazarPct: number; // absolute % of total production
  readonly kapiSatisiPct: number; // % of the export (dış) remainder
  readonly kazakistanPct: number;
  readonly rusyaPct: number;
}
const DIST_VALUES: readonly (readonly [number, number, number, number])[] = [
  [12, 25, 50, 25],
  [12, 31, 48, 21],
  [12, 26, 46, 28],
  [12, 33, 46, 21],
  [25, 32, 42, 26],
  [35, 22, 54, 24],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];
export const SALES_DIST_DOMATES: readonly DistRow[] = MONTHS_TR.map((month, i) => ({
  month,
  icPazarPct: DIST_VALUES[i][0],
  kapiSatisiPct: DIST_VALUES[i][1],
  kazakistanPct: DIST_VALUES[i][2],
  rusyaPct: DIST_VALUES[i][3],
}));

// ─── Monthly transport loss (%) — Ýol Ýitgisi ───────────────────────────
export interface FireRow {
  readonly month: string;
  readonly kazakistanPct: number;
  readonly rusyaPct: number;
}
const FIRE_VALUES: readonly (readonly [number, number])[] = [
  [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [2, 2],
  [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
];
export const FIRE_ORANI: readonly FireRow[] = MONTHS_TR.map((month, i) => ({
  month,
  kazakistanPct: FIRE_VALUES[i][0],
  rusyaPct: FIRE_VALUES[i][1],
}));

// ─── Export channels (dış bazar kanalları) ──────────────────────────────
export const DEFAULT_EXPORT_CHANNELS: readonly string[] = ['Kazakistan', 'Rusya'];
