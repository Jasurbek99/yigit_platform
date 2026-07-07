import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

/** Packing numbers; decimals arrive as strings, counts as numbers. */
export interface IPackingValues {
  gross_kg: string | null;
  box_count: number | null;
  pallet_count: string | null;
  pallet_weight_kg: string | null;
}

export interface IShipmentPackingRow {
  export_firm: number;
  export_firm_code: string;
  export_firm_name: string;
  weight_kg: string | null;
  sale_id: number | null;
  /** Derived from the truck config by weight share. */
  derived: IPackingValues;
  /** Manual override (null field = use derived). */
  override: IPackingValues;
}

export interface IShipmentPacking {
  shipment: number;
  whole_truck: {
    packing_preset: number | null;
    packing_preset_name: string | null;
    net_kg: string | null;
    gross_kg: string | null;
    box_count: number | null;
    pallet_count: string | null;
    pallet_weight_kg: string | null;
  };
  total_firm_weight: string;
  /** Poka-yoke: Σ firm weights === truck config net. */
  consistent: boolean;
  rows: IShipmentPackingRow[];
}

/** GET the unified per-truck packing state (truck config + derived/override per firm). */
export function useShipmentPacking(shipmentId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['shipment-packing', shipmentId] as const,
    enabled: enabled && shipmentId != null,
    queryFn: async (): Promise<IShipmentPacking> => {
      const { data } = await api.get<IShipmentPacking>('/contracts/shipment-packing/', {
        params: { shipment: shipmentId },
      });
      return data;
    },
  });
}

interface ISetTruckPayload {
  shipment: number;
  scope: 'truck';
  packing_preset: number | null;
}
interface ISetFirmPayload {
  shipment: number;
  scope: 'firm';
  export_firm: number;
  gross_kg?: number | string | null;
  box_count?: number | null;
  pallet_count?: number | string | null;
  pallet_weight_kg?: number | string | null;
}
type ISetPackingPayload = ISetTruckPayload | ISetFirmPayload;

/** Set the whole-truck config, or a firm's packing override (null clears a field). */
export function useSetShipmentPacking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ISetPackingPayload): Promise<void> => {
      await api.post('/contracts/shipment-packing/', payload);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['shipment-packing', vars.shipment] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}

/**
 * Set the per-firm split weights via the quota-safe firm-splits endpoint
 * (replaces all splits; runs draft quota sync server-side).
 */
export function useApplyFirmSplit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      shipmentId, firms,
    }: { shipmentId: number; firms: { export_firm_id: number; weight_kg: number }[] }): Promise<void> => {
      await api.post(`/export/shipments/${shipmentId}/firm-splits/`, { firms });
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['shipment-packing', vars.shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}
