import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IShipmentDetail, ISalesReportPayload } from '@/types';

/**
 * Mutation hook to POST/PATCH the richer Sales Report for a shipment.
 * POST get-or-creates on the backend, so a single action covers both create and update.
 * On success, the shipment detail query is invalidated so the UI re-reads the
 * updated `sales_report` from the detail response.
 *
 * The query key `['shipment', id]` must be a string — matches `useShipmentDetail`,
 * which keys on the raw route param (e.g. '42', not 42).
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
      void queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] });
    },
  });
}
