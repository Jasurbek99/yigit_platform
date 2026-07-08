import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export interface IShipmentPackingRow {
  export_firm: number;
  export_firm_code: string;
  export_firm_name: string;
  weight_kg: string | null;
  sale_id: number | null;
  gross_kg: string | null;
  box_count: number | null;
  pallet_count: string | null;
  pallet_weight_kg: string | null;
}

export interface IShipmentPacking {
  shipment: number;
  whole_truck: {
    packing_template: number | null;
    packing_template_name: string | null;
    net_kg: string | null;
    gross_kg: string | null;
    box_count: number | null;
    pallet_count: string | null;
    pallet_weight_kg: string | null;
  };
  total_firm_weight: string;
  consistent: boolean;
  rows: IShipmentPackingRow[];
}

/** GET the unified per-truck packing state (template whole-truck + per-firm actual). */
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

interface IApplyTemplate { shipment: number; scope: 'template'; packing_template: number }
interface IEditFirm {
  shipment: number; scope: 'firm'; export_firm: number;
  gross_kg?: number | null; box_count?: number | null;
  pallet_count?: number | null; pallet_weight_kg?: number | null;
}
interface ISwap { shipment: number; scope: 'swap'; export_firm_a: number; export_firm_b: number }
type IPackingPost = IApplyTemplate | IEditFirm | ISwap;

/** Apply a template, edit a firm's packing, or swap two firms. */
export function useSetShipmentPacking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IPackingPost): Promise<void> => {
      await api.post('/contracts/shipment-packing/', payload);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['shipment-packing', vars.shipment] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      // Applying packing flips the truck's packing_complete on the Documents page,
      // enabling its CMR/invoice generation — refresh the packet list.
      queryClient.invalidateQueries({ queryKey: ['document-packets'] });
    },
  });
}
