import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';

/** One bar / slice / table row. `name` is null for trucks with no value in that dimension. */
export interface ITirHasabatRow {
  name: string | null;
  trucks: number;
  kg: number;
}

/**
 * A grouping plus its own kg total. Firm and block groups read kg from their
 * own tables, so their `total_kg` differs from `kpis.total_kg` on purpose —
 * shares are computed against this total, never the headline one.
 */
export interface ITirHasabatGroup {
  rows: ITirHasabatRow[];
  total_kg: number;
}

export interface ITirHasabatResponse {
  season: { id: number; name: string } | null;
  kpis: {
    total_trucks: number;
    total_kg: number;
    avg_kg: number;
    open_trucks: number;
    arrived_trucks: number;
  };
  /** Oldest first; `month` is 'YYYY-MM'. */
  by_month: { month: string; trucks: number; kg: number }[];
  by_country: ITirHasabatGroup;
  by_customer: ITirHasabatGroup;
  by_variety: ITirHasabatGroup;
  by_firm: ITirHasabatGroup;
  by_block: ITirHasabatGroup;
}

/** GET /export/tir-hasabat/ — every number is a JSON number (floats cast server-side). */
export const useTirHasabat = () => {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery<ITirHasabatResponse>({
    queryKey: ['tir-hasabat', seasonId],
    queryFn: () =>
      api
        .get<ITirHasabatResponse>('/export/tir-hasabat/', {
          params: seasonId != null ? { season: seasonId } : {},
        })
        .then((r) => r.data),
    enabled: isReady,
    staleTime: 60_000,
  });
};
