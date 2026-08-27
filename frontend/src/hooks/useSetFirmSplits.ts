import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import api from '@/services/api';
import { getShipmentDetailKey } from './useShipmentDetail';
import { extractPatchError, invalidateExceptSheet } from './useShipmentPatch';

/**
 * Replace a shipment's export-firm splits from the detail page.
 *
 * POSTs `{ firms: [{ export_firm_id }] }` to the existing
 * `/export/shipments/{id}/firm-splits/` action — the same endpoint the Sheet's
 * firm cell uses. The backend recomputes each firm's official `weight_kg` from
 * the firm count and hard-blocks a no-quota firm (400), so callers only pick
 * which firms; the error message is surfaced verbatim.
 */
export function useSetFirmSplits(shipmentId: number) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<unknown, unknown, number[]>({
    mutationFn: async (firmIds: number[]) => {
      const { data } = await api.post(`/export/shipments/${shipmentId}/firm-splits/`, {
        firms: firmIds.map((id) => ({ export_firm_id: id })),
      });
      return data;
    },
    onSuccess: () => {
      toast.success(t('firm_selector.saved'));
      invalidateExceptSheet(queryClient);
      queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(shipmentId) });
      // A split edit changes committed quota, so the no-quota flags must refresh.
      queryClient.invalidateQueries({ queryKey: ['quota-firm-balances'] });
    },
    onError: (err) => {
      toast.error(extractPatchError(err, t('firm_selector.save_error')));
    },
  });
}
