import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

/** Who already recorded a step, and when the event itself was. */
export interface IScanAlready {
  field: string;
  occurred_at: string | null;
  recorded_by: string | null;
}

export interface IScanState {
  id: number;
  code: string;
  export_code: string | null;
  status: string | null;
  /** The trigger field a scan would fill now, or null when there is nothing to record. */
  field: string | null;
  /** Present on a POST response only. */
  recorded?: boolean;
  /** Present when the step was already recorded — show this instead of a button. */
  already?: IScanAlready;
}

export function shipmentScanKey(id: string | number) {
  return ['shipment-scan', String(id)] as const;
}

export function useShipmentScan(id: string | number | undefined) {
  return useQuery({
    queryKey: shipmentScanKey(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<IScanState> => {
      const { data } = await api.get<IScanState>(`/export/shipments/${id}/scan/`);
      return data;
    },
    // A pallet label is scanned in the yard, often minutes apart by different
    // people — never serve a cached "nothing recorded yet" that another
    // operator has since invalidated.
    staleTime: 0,
    retry: false,
  });
}

export function useRecordShipmentScan(id: string | number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (field: string): Promise<IScanState> => {
      const { data } = await api.post<IScanState>(
        `/export/shipments/${id}/scan/`,
        { field },
      );
      return data;
    },
    // Refetch whether it recorded or came back "already done": the second
    // scanner must end up looking at the truck's real current state, and the
    // status may have advanced, which changes what the next step is.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shipmentScanKey(id ?? '') });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}
