import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

/** One greenhouse block's planned-vs-achieved production over a date range. */
export interface IProductionAnalysisRow {
  block_id: number;
  block_code: string;
  block_name: string;
  plan_kg: number;
  /** Export + domestic — what the block actually moved. NOT the nightly rollup. */
  actual_kg: number;
  /** Diagnostic: HarvestDayEntry.actual_value. Diverges when the rollup is stale. */
  rollup_kg: number;
  /** Days in range that carry a rollup value. 0 = the job never ran for them. */
  rollup_days: number;
  /** actual − plan. Negative = short of plan. */
  variance_kg: number;
  achievement_pct: number;
  area_m2: number | null;
  plan_kg_per_m2: number;
  actual_kg_per_m2: number;
  domestic_kg: number;
  export_kg: number;
  domestic_pct: number;
  export_pct: number;
}

export interface IProductionAnalysisTotals
  extends Omit<
    IProductionAnalysisRow,
    'block_id' | 'block_code' | 'block_name' | 'rollup_days'
  > {
  block_count: number;
}

export interface IProductionAnalysis {
  date_from: string;
  date_to: string;
  rows: IProductionAnalysisRow[];
  totals: IProductionAnalysisTotals;
}

export interface IProductionAnalysisFilters {
  /** ISO date, inclusive. */
  dateFrom: string;
  /** ISO date, inclusive. */
  dateTo: string;
  /** Top-level block ids; omit or leave empty for all blocks. */
  blockIds?: number[];
}

/**
 * Planned vs achieved production per block — the Pomidor Dükany analysis.
 *
 * The caller owns the date range: the page derives it from its weekly /
 * monthly / seasonal / cumulative-to-a-day mode, so every mode is the same
 * request with different bounds. No season param — the range already scopes
 * it, matching how the /boss production aggregates work.
 */
export function useProductionAnalysis(filters: IProductionAnalysisFilters) {
  const { dateFrom, dateTo, blockIds } = filters;
  // Sorted + joined so a re-ordered selection doesn't miss the cache.
  const blocksKey = blockIds?.length ? [...blockIds].sort((a, b) => a - b).join(',') : '';

  return useQuery({
    queryKey: ['production-analysis', dateFrom, dateTo, blocksKey],
    queryFn: async (): Promise<IProductionAnalysis> => {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (blocksKey) params.set('blocks', blocksKey);
      const { data } = await api.get<IProductionAnalysis>(
        `/export/production-analysis/?${params}`,
      );
      return data;
    },
    enabled: Boolean(dateFrom && dateTo),
    staleTime: 60_000,
  });
}
