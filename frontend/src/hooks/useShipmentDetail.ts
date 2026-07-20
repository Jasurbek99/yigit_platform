import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/**
 * Query key for a single shipment detail.
 *
 * String(id) is REQUIRED, not cosmetic. Every invalidation site in the app uses
 * ['shipment', String(id)] (useShipmentPatch, useTaskActions, usePallets,
 * TransitionButton...). TanStack matches key parts type-strictly, so a numeric
 * caller — the task drawer passes task.shipment as a number — would key
 * ['shipment', 42] and silently miss every ['shipment', '42'] invalidation,
 * leaving the drawer's progress bar stale until remount.
 */
export function getShipmentDetailKey(id: number | string | undefined): readonly unknown[] {
  return ['shipment', id == null ? id : String(id)];
}

export function useShipmentDetail(id: number | string | undefined) {
  return useQuery({
    queryKey: getShipmentDetailKey(id),
    queryFn: async (): Promise<IShipmentDetail> => {
      if (USE_MOCK) return MOCK_SHIPMENT_DETAIL;
      const { data } = await api.get<IShipmentDetail>(`/export/shipments/${id}/`);
      return data;
    },
    enabled: id != null,
    staleTime: 30_000,
  });
}
