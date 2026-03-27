import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_OVERDUE_RESPONSE } from '@/mock/overdue';
import type { IApiListResponse, IOverdueShipment } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const DEFAULT_THRESHOLD = 7;

export function useOverdueShipments(threshold: number = DEFAULT_THRESHOLD) {
  return useQuery({
    queryKey: ['shipments', 'overdue', threshold],
    queryFn: async (): Promise<IApiListResponse<IOverdueShipment>> => {
      if (USE_MOCK) return MOCK_OVERDUE_RESPONSE;

      const params = new URLSearchParams();
      params.set('threshold', String(threshold));

      const { data } = await api.get<IApiListResponse<IOverdueShipment>>(
        `/export/shipments/overdue/?${params.toString()}`,
      );
      return data;
    },
    staleTime: 60_000,
  });
}
