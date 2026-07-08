import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IShipmentFirmContracts } from '@/types/contract';

/** GET per-firm contract state for a shipment (framework options + linked). */
export function useShipmentFirmContracts(shipmentId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['shipment-firm-contracts', shipmentId] as const,
    enabled: enabled && shipmentId != null,
    queryFn: async (): Promise<IShipmentFirmContracts> => {
      const { data } = await api.get<IShipmentFirmContracts>(
        '/contracts/shipment-firm-contracts/',
        { params: { shipment: shipmentId } },
      );
      return data;
    },
  });
}

interface ILinkPayload {
  shipment: number;
  export_firm: number;
  mode: 'framework' | 'one_time';
  contract_id?: number;
}

export interface ILinkResult {
  export_firm: number;
  contract_id: number;
  contract_number: string;
  contract_type: 'FRAMEWORK' | 'ONE_TIME';
  money_warning: 'bank' | 'cash' | null;
}

/** Link a firm split to a framework contract or create+link a one-time one. */
export function useLinkFirmContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ILinkPayload): Promise<ILinkResult> => {
      const { data } = await api.post<ILinkResult>(
        '/contracts/shipment-firm-contracts/',
        payload,
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['shipment-firm-contracts', vars.shipment] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      // Linking creates the bridge ContractSale → the Documents page packet gains
      // the firm's sale_id, so its invoice/letter buttons appear.
      queryClient.invalidateQueries({ queryKey: ['document-packets'] });
    },
  });
}
