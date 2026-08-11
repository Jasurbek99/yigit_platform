import type { IBossProductionRow, IBossExportMarketRow } from '@/hooks/useBossDashboard';

/** One greenhouse block's figures across all four time windows. */
export interface IMergedBlockRow {
  block_code: string;
  block_name: string;
  daily_plan_kg: number;
  daily_actual_kg: number;
  monthly_plan_kg: number;
  monthly_actual_kg: number;
  seasonal_plan_kg: number;
  seasonal_actual_kg: number;
  seasonal_pct: number;
  export_kg: number;
  export_pct: number;
}

export type IBlockTotals = Omit<IMergedBlockRow, 'block_code' | 'block_name'>;

/**
 * Column widths, shared by the group-header, column-header, data and total rows
 * so all four stay in lockstep. Ten columns:
 * block | daily plan/actual | monthly plan/actual | seasonal plan/actual | export kg/% | bar
 */
export const GRID_TEMPLATE = '1.5fr 0.9fr 0.9fr 0.9fr 0.9fr 1fr 1fr 1.1fr 0.6fr 1.5fr';

const ZERO_TOTALS: IBlockTotals = {
  daily_plan_kg: 0,
  daily_actual_kg: 0,
  monthly_plan_kg: 0,
  monthly_actual_kg: 0,
  seasonal_plan_kg: 0,
  seasonal_actual_kg: 0,
  seasonal_pct: 0,
  export_kg: 0,
  export_pct: 0,
};

/**
 * Join the three per-block responses into one row per block.
 *
 * All three backend aggregators build their rows from the same
 * `GreenhouseBlock.objects.all().order_by('code')` query, so in practice every
 * block appears in every response and this is a 1:1 join. That is a property of
 * today's backend, not a contract this code can enforce — so a block missing
 * from the seasonal or export response is zero-filled rather than reaching the
 * render as `undefined`. The daily response drives the row set and the order;
 * an export row for an unknown block is dropped, since it has no name to show.
 *
 * `monthly_*` is read from the daily response only: the backend derives it from
 * today's calendar month independently of `scope`, so the seasonal response
 * carries an identical copy.
 */
export function mergeBlockRows(
  daily: IBossProductionRow[],
  seasonal: IBossProductionRow[],
  market: IBossExportMarketRow[],
): IMergedBlockRow[] {
  const seasonalByCode = new Map(seasonal.map((r) => [r.block_code, r]));
  const marketByCode = new Map(market.map((r) => [r.block_code, r]));

  return daily.map((d) => {
    const s = seasonalByCode.get(d.block_code);
    const m = marketByCode.get(d.block_code);
    return {
      block_code: d.block_code,
      block_name: d.block_name,
      daily_plan_kg: d.plan_kg,
      daily_actual_kg: d.actual_kg,
      monthly_plan_kg: d.monthly_plan_kg,
      monthly_actual_kg: d.monthly_actual_kg,
      seasonal_plan_kg: s?.plan_kg ?? 0,
      seasonal_actual_kg: s?.actual_kg ?? 0,
      seasonal_pct: s?.pct ?? 0,
      export_kg: m?.export_kg ?? 0,
      export_pct: m?.export_pct ?? 0,
    };
  });
}

/**
 * Column totals for the footer row.
 *
 * `seasonal_pct` is recomputed from the summed plan and actual — averaging the
 * per-row percentages would weight a block that harvested 200 kg the same as one
 * that harvested 200 t.
 */
export function sumTotals(rows: IMergedBlockRow[]): IBlockTotals {
  if (rows.length === 0) return { ...ZERO_TOTALS };

  const totals = rows.reduce<IBlockTotals>(
    (acc, r) => ({
      daily_plan_kg: acc.daily_plan_kg + r.daily_plan_kg,
      daily_actual_kg: acc.daily_actual_kg + r.daily_actual_kg,
      monthly_plan_kg: acc.monthly_plan_kg + r.monthly_plan_kg,
      monthly_actual_kg: acc.monthly_actual_kg + r.monthly_actual_kg,
      seasonal_plan_kg: acc.seasonal_plan_kg + r.seasonal_plan_kg,
      seasonal_actual_kg: acc.seasonal_actual_kg + r.seasonal_actual_kg,
      seasonal_pct: 0,
      export_kg: acc.export_kg + r.export_kg,
      export_pct: acc.export_pct + r.export_pct,
    }),
    { ...ZERO_TOTALS },
  );

  totals.seasonal_pct = totals.seasonal_plan_kg > 0
    ? (totals.seasonal_actual_kg / totals.seasonal_plan_kg) * 100
    : 0;

  return totals;
}
