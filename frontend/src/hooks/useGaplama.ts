import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IGaplamaDay, IGaplamaTruck, IGaplamaWeekTotal } from '@/types';

interface IGaplamaBoardResponse {
  days: IGaplamaDay[];
  trucks: IGaplamaTruck[];
  week_totals: IGaplamaWeekTotal[];
}

// Raw shapes exactly as the backend sends them, before the fetch-boundary
// coercion below — decimal fields arrive as strings (api-contract convention).
interface IGaplamaCarryInBucketRaw {
  origin_date: string;
  kg: string;
  age_days: number;
}

interface IGaplamaDayRaw {
  date: string;
  block_id: number;
  block_code: string;
  location: string | null;
  plan_kg: string;
  loaded_kg: string;
  carried_in_kg: string;
  carry_in_breakdown: IGaplamaCarryInBucketRaw[];
  available_kg: string;
  over_kg: string;
  carried_out_kg: string;
}

interface IGaplamaTruckSourceRaw {
  block_id: number;
  block_code: string;
  weight_kg: string;
}

interface IGaplamaTruckRaw {
  id: number;
  shipment_code: string;
  export_code: string | null;
  date: string;
  status: number;
  status_code: string;
  status_display: string;
  country: number | null;
  customer: number | null;
  block_sources: IGaplamaTruckSourceRaw[];
}

interface IGaplamaWeekTotalRaw {
  block_id: number;
  block_code: string;
  location: string | null;
  plan_kg: string;
  loaded_kg: string;
  over_kg: string;
  available_kg: string;
}

interface IGaplamaBoardResponseRaw {
  days: IGaplamaDayRaw[];
  trucks: IGaplamaTruckRaw[];
  // Omitted by the two early-return empty-board responses on older deploys —
  // defaulted to [] below, same as days/trucks already are.
  week_totals?: IGaplamaWeekTotalRaw[];
}

function coerceDay(raw: IGaplamaDayRaw): IGaplamaDay {
  return {
    ...raw,
    plan_kg: Number(raw.plan_kg) || 0,
    loaded_kg: Number(raw.loaded_kg) || 0,
    carried_in_kg: Number(raw.carried_in_kg) || 0,
    carry_in_breakdown: (raw.carry_in_breakdown ?? []).map((b) => ({
      origin_date: b.origin_date,
      kg: Number(b.kg) || 0,
      age_days: b.age_days,
    })),
    available_kg: Number(raw.available_kg) || 0,
    over_kg: Number(raw.over_kg) || 0,
    carried_out_kg: Number(raw.carried_out_kg) || 0,
  };
}

function coerceTruck(raw: IGaplamaTruckRaw): IGaplamaTruck {
  return {
    ...raw,
    block_sources: (raw.block_sources ?? []).map((s) => ({
      ...s,
      weight_kg: Number(s.weight_kg) || 0,
    })),
  };
}

function coerceWeekTotal(raw: IGaplamaWeekTotalRaw): IGaplamaWeekTotal {
  return {
    ...raw,
    plan_kg: Number(raw.plan_kg) || 0,
    loaded_kg: Number(raw.loaded_kg) || 0,
    over_kg: Number(raw.over_kg) || 0,
    available_kg: Number(raw.available_kg) || 0,
  };
}

/**
 * Fetches the Gaplama board (plan / loaded / carry-in / available per block-day,
 * week-aggregate totals, plus opened trucks) for a date range. Decimal strings are
 * coerced to numbers here, at the fetch boundary — never at the usage site
 * (api-contract skill).
 */
export function useGaplamaBoard(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['gaplama-board', fromDate, toDate],
    queryFn: async (): Promise<IGaplamaBoardResponse> => {
      const { data } = await api.get<IGaplamaBoardResponseRaw>(
        `/export/gaplama/board/?from_date=${fromDate}&to_date=${toDate}`,
      );
      return {
        days: (data.days ?? []).map(coerceDay),
        trucks: (data.trucks ?? []).map(coerceTruck),
        week_totals: (data.week_totals ?? []).map(coerceWeekTotal),
      };
    },
    staleTime: 15_000,
  });
}

/**
 * Edits an existing Gaplama truck's block/kg split (the Üýtget form). One
 * call to the block-sources endpoint with `sync_weight_net: true`, which
 * writes the split AND the new weight_net total in one server-side
 * transaction (backend/apps/export/views.py, ShipmentViewSet.set_block_sources).
 *
 * Used to be two separate requests — POST block-sources, then PATCH
 * weight_net — each behind its own gate. A 403/500/dropped connection on
 * the second call left the split rewritten with the total still stale
 * (2026-09-25 fix). onError still invalidates: even a clean 403 on this
 * single call happens before any write now, but a network failure after
 * the response left the server means the cache should still refresh to
 * the real state.
 */
export function useUpdateTruckBlocks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      shipmentId: number;
      rows: { block_id: number; weight_kg: number; harvest_date?: string | null }[];
    }) => {
      // The real request body key is "blocks", not "block_sources" — verified
      // against ShipmentViewSet.set_block_sources (backend/apps/export/views.py:3223-3291):
      // `blocks_data = request.data.get('blocks', [])`. Sending weight_kg on every
      // row (never 0/omitted) avoids the endpoint's auto-split-by-weight_net path,
      // which only activates when weight_kg is missing/0/"0"/"0.00".
      //
      // harvest_date forwarded per row (2026-09-24, gaplama batch selection) — that
      // same view reads it per entry (`entry['harvest_date']`) as the batch the
      // operator picked. Omitting it here used to make every edit exercise the
      // endpoint's own "no harvest_date" preserve/proportional-split branch instead
      // of the operator's actual new selection (task-7b-report.md's Concerns
      // section) — an edit that changed which batch a block drew from would
      // silently revert to the batch ratio the block already had. Left optional on
      // the type (not every caller of this hook knows a batch date), only included
      // per-row when present so a bare {block_id, weight_kg} call still posts the
      // same shape it always has.
      //
      // `undefined` (key never set) vs explicit `null` are DIFFERENT requests to
      // that same view (2026-09-25, leftover-batch collapse): an explicit key
      // (even null) always overrides with one dateless row; an OMITTED key falls
      // into the preserve/proportional-split branch above, which re-splits the
      // incoming weight across the shipment's PRIOR block_sources — exactly the
      // per-date leftover rows this feature folds into one. The leftover row's
      // harvestDate is always explicitly null (never absent) on the caller's row
      // object, so `r.harvest_date` alone (falsy-checked) would wrongly omit it —
      // checking `!== undefined` forwards null but still omits a truly absent key.
      await api.post(`/export/shipments/${vars.shipmentId}/block-sources/`, {
        blocks: vars.rows.map((r) => ({
          block_id: r.block_id,
          weight_kg: r.weight_kg,
          ...(r.harvest_date !== undefined ? { harvest_date: r.harvest_date } : {}),
        })),
        // Server computes the new weight_net from the rows it just wrote —
        // the number is never taken from the client (see set_block_sources's
        // docstring), so nothing is sent here beyond the flag itself.
        sync_weight_net: true,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['gaplama-board'] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}
