import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { getShipmentDetailKey } from '@/hooks/useShipmentDetail';

/** PATCH /export/shipments/{id}/custom-fields/ — one admin custom row's value (free text). */
export function usePatchCustomField(shipmentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fieldKey, value }: { fieldKey: string; value: string }) => {
      await api.patch(`/export/shipments/${shipmentId}/custom-fields/`, { field_key: fieldKey, value });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(shipmentId) }),
  });
}
