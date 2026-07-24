/**
 * Sera Bütçe — Önümçilik (Aylık Üretim) page mock data.
 *
 * Per-block monthly production (kg), derived from each block's annual
 * `SERA_BLOCKS.productionKg` (shared dataset) using a seasonal weight curve.
 * Only Ýanwar–Iýun (Jan–Jun) carry data — Iýul–Dekabr are 0, matching the
 * "current season" window already used by the other monthly mock series
 * (`SALES_QTY_BY_CHANNEL`, `MONTHLY_TREND`, …) in `seraData.ts`.
 *
 * `MONTH_WEIGHTS[0]` is fixed so that Dusak A / Ocak reproduces the source
 * app's reference figure (382.725 kg) exactly; the remaining months follow a
 * plausible spring ramp-up/taper shape.
 */
import { SERA_BLOCKS } from './seraData';

const DUSAK_A_ANNUAL_KG = 2787600; // SERA_BLOCKS 'DUS-A'
const DUSAK_A_JAN_KG = 382725; // reference screenshot: Dusak A, Ocak, single-block/single-month view

const JAN_WEIGHT = DUSAK_A_JAN_KG / DUSAK_A_ANNUAL_KG;
const REST_WEIGHTS_RAW = [0.145, 0.165, 0.205, 0.215, 0.1327]; // Şubat..Haziran shape
const REST_WEIGHTS_SUM = REST_WEIGHTS_RAW.reduce((a, b) => a + b, 0);
const REST_SCALE = (1 - JAN_WEIGHT) / REST_WEIGHTS_SUM;

/** 6 weights (Ocak..Haziran) summing to 1. */
const MONTH_WEIGHTS: readonly number[] = [JAN_WEIGHT, ...REST_WEIGHTS_RAW.map((w) => w * REST_SCALE)];

/** blockId → 12 monthly production values (kg); Temmuz..Aralık are 0. */
export const MONTHLY_PRODUCTION_BY_BLOCK: Record<string, readonly number[]> = Object.fromEntries(
  SERA_BLOCKS.map((b) => [
    b.id,
    [...MONTH_WEIGHTS.map((w) => Math.round(b.productionKg * w)), 0, 0, 0, 0, 0, 0],
  ]),
);
