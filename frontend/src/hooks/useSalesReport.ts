import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { getShipmentDetailKey } from './useShipmentDetail';
import type { IShipmentDetail, ISalesReportPayload } from '@/types';

/**
 * Mutation hook to POST/PATCH the richer Sales Report for a shipment.
 * POST get-or-creates on the backend, so a single action covers both create and update.
 * On success, the shipment detail query is invalidated so the UI re-reads the
 * updated `sales_report` from the detail response.
 *
 * The detail query key comes from `getShipmentDetailKey()`, which normalises the
 * id — a hand-written `['shipment', id]` here would silently miss the cache if a
 * caller ever passed a number (TanStack matches key parts type-strictly).
 */
export function useSaveSalesReport(shipmentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ISalesReportPayload): Promise<IShipmentDetail> => {
      const { data } = await api.post<IShipmentDetail>(
        `/export/shipments/${shipmentId}/sales-report/`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(shipmentId) });
      // Both worklists key off report existence, so a save moves rows between
      // tabs. Invalidate by prefix — the season/threshold suffixes vary.
      void queryClient.invalidateQueries({ queryKey: ['shipments', 'my-sales-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['shipments', 'overdue'] });
    },
  });
}
