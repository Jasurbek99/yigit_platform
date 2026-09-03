import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { IShipmentFirmContracts } from '@/types/contract';

/** shipment id (as a string key) → number of its firms with a live contract. */
export type IShipmentContractStatus = Record<string, number>;

export const CONTRACT_STATUS_KEY = ['shipment-contract-status'] as const;

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

/**
 * Season-wide map of linked-contract counts, for the Sheet's contracts cell
 * icon. One request for the whole sheet; the row's own `firm_splits.length` is
 * the denominator. Gated by the `sale` resource on the backend — pass
 * `enabled=false` for roles without it rather than eating a 403 per sheet load.
 */
export function useShipmentContractStatus(enabled = true) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: [...CONTRACT_STATUS_KEY, seasonId] as const,
    enabled: enabled && isReady,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<IShipmentContractStatus> => {
      const { data } = await api.get<IShipmentContractStatus>(
        '/contracts/shipment-contract-status/',
        seasonId != null ? { params: { season: seasonId } } : undefined,
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
      // Repaints the Sheet's contracts-cell icon (grey → amber → green).
      queryClient.invalidateQueries({ queryKey: CONTRACT_STATUS_KEY });
      // Linking creates the bridge ContractSale → the Documents page packet gains
      // the firm's sale_id, so its invoice/letter buttons appear.
      queryClient.invalidateQueries({ queryKey: ['document-packets'] });
    },
  });
}
