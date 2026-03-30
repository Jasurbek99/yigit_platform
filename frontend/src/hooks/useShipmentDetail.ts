import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export function useShipmentDetail(id: number | string | undefined) {
  return useQuery({
    queryKey: ['shipment', id],
    queryFn: async (): Promise<IShipmentDetail> => {
      if (USE_MOCK) return MOCK_SHIPMENT_DETAIL;
      const { data } = await api.get<IShipmentDetail>(`/export/shipments/${id}/`);
      return data;
    },
    enabled: id != null,
    staleTime: 30_000,
  });
}
