/**
 * Pomidor Dükany — per-block içerki (domestic) / daşarky (export + gapy
 * satyş) market split, derived from SERA_BLOCKS.productionKg.
 *
 * The source app splits each block's planned production ~12% içerki /
 * ~88% daşarky (matching the platform-wide İçerki Bazar share seen in
 * SERA_TOTALS: domesticKg / productionKg ≈ 18.8% seasonally, ~12% for the
 * single reference month used here). "Hakyky" (actual) columns are all 0 —
 * Logo Tiger has not been connected yet, only sample/mock figures exist.
 */
import { SERA_BLOCKS } from './seraData';

const DOMESTIC_SHARE = 0.12;

export interface PomidorBlockRow {
  readonly id: string;
  readonly name: string;
  readonly planKg: number;
  readonly actualKg: number;
  readonly domesticPlanKg: number;
  readonly domesticActualKg: number;
  readonly exportPlanKg: number;
  readonly exportActualKg: number;
}

export const POMIDOR_BLOCK_ROWS: readonly PomidorBlockRow[] = SERA_BLOCKS.map((b) => {
  const domesticPlanKg = Math.round(b.productionKg * DOMESTIC_SHARE);
  return {
    id: b.id,
    name: b.name,
    planKg: b.productionKg,
    actualKg: 0,
    domesticPlanKg,
    domesticActualKg: 0,
    exportPlanKg: b.productionKg - domesticPlanKg,
    exportActualKg: 0,
  };
});

export const POMIDOR_TOTALS = POMIDOR_BLOCK_ROWS.reduce(
  (acc, r) => ({
    planKg: acc.planKg + r.planKg,
    actualKg: acc.actualKg + r.actualKg,
    domesticPlanKg: acc.domesticPlanKg + r.domesticPlanKg,
    domesticActualKg: acc.domesticActualKg + r.domesticActualKg,
    exportPlanKg: acc.exportPlanKg + r.exportPlanKg,
    exportActualKg: acc.exportActualKg + r.exportActualKg,
  }),
  { planKg: 0, actualKg: 0, domesticPlanKg: 0, domesticActualKg: 0, exportPlanKg: 0, exportActualKg: 0 },
);
