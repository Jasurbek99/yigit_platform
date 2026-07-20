import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/**
 * The single source of truth for the shipment-detail query key.
 *
 * USE THIS — never hand-write ['shipment', id]. TanStack matches key parts
 * type-strictly, so a reader keying on a raw number (['shipment', 42]) silently
 * misses every ['shipment', '42'] invalidation: no error, no failed request,
 * just a view that never refreshes. That exact mismatch shipped once — the
 * /me/board task drawer passes task.shipment as a number, and its progress bar
 * only updated on remount. Normalising here makes the class of bug impossible,
 * and routing every reader + invalidator through one function keeps it that way.
 *
 * Returns id unchanged when nullish so a disabled query keeps a stable key.
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
