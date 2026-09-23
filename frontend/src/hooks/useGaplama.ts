import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IGaplamaDay, IGaplamaTruck } from '@/types';

interface IGaplamaBoardResponse {
  days: IGaplamaDay[];
  trucks: IGaplamaTruck[];
}

// Raw shapes exactly as the backend sends them, before the fetch-boundary
// coercion below — decimal fields arrive as strings (api-contract convention).
interface IGaplamaDayRaw {
  date: string;
  block_id: number;
  block_code: string;
  location: string | null;
  plan_kg: string;
  loaded_kg: string;
  carried_in_kg: string;
  available_kg: string;
  over_kg: string;
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

interface IGaplamaBoardResponseRaw {
  days: IGaplamaDayRaw[];
  trucks: IGaplamaTruckRaw[];
}

function coerceDay(raw: IGaplamaDayRaw): IGaplamaDay {
  return {
    ...raw,
    plan_kg: Number(raw.plan_kg) || 0,
    loaded_kg: Number(raw.loaded_kg) || 0,
    carried_in_kg: Number(raw.carried_in_kg) || 0,
    available_kg: Number(raw.available_kg) || 0,
    over_kg: Number(raw.over_kg) || 0,
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

/**
 * Fetches the Gaplama board (plan / loaded / carry-in / available per block-day,
 * plus opened trucks) for a date range. Decimal strings are coerced to numbers
 * here, at the fetch boundary — never at the usage site (api-contract skill).
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
      };
    },
    staleTime: 15_000,
  });
}

/**
 * Edits an existing Gaplama truck's block/kg split (the Üýtget form). Writes through
 * the existing block-sources endpoint, then syncs weight_net to the new total —
 * both calls the Sheet's own editors already make.
 *
 * Two-call write, two separate server-side gates (POST block-sources needs
 * shipment.can_create, PATCH weight_net needs shipment.can_edit + a field
 * grant) — the first call can land and the second can still 403, leaving the
 * split rewritten but the total weight stale. Invalidation therefore runs in
 * onSettled, not onSuccess: whichever calls actually landed, the user must
 * see the shipment's real current state, not a stale cache, on success OR
 * failure. Invalidates drafts/shipments too — the Sheet and Drafts page read
 * this same shipment through those query keys, not just gaplama-board.
 */
export function useUpdateTruckBlocks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      shipmentId: number;
      rows: { block_id: number; weight_kg: number }[];
    }) => {
      // The real request body key is "blocks", not "block_sources" — verified
      // against ShipmentViewSet.set_block_sources (backend/apps/export/views.py:3223-3291):
      // `blocks_data = request.data.get('blocks', [])`. Sending weight_kg on every
      // row (never 0/omitted) avoids the endpoint's auto-split-by-weight_net path,
      // which only activates when weight_kg is missing/0/"0"/"0.00".
      await api.post(`/export/shipments/${vars.shipmentId}/block-sources/`, {
        blocks: vars.rows.map((r) => ({ block_id: r.block_id, weight_kg: r.weight_kg })),
      });
      const weightNet = vars.rows.reduce((sum, r) => sum + r.weight_kg, 0);
      await api.patch(`/export/shipments/${vars.shipmentId}/`, { weight_net: weightNet });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['gaplama-board'] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}
