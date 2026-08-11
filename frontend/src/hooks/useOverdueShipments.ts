import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import { MOCK_OVERDUE_RESPONSE } from '@/mock/overdue';
import type { IApiListResponse, IOverdueShipment } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const DEFAULT_THRESHOLD = 7;

export function useOverdueShipments(threshold: number = DEFAULT_THRESHOLD) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['shipments', 'overdue', seasonId, threshold],
    queryFn: async (): Promise<IApiListResponse<IOverdueShipment>> => {
      if (USE_MOCK) return MOCK_OVERDUE_RESPONSE;

      const params = new URLSearchParams();
      params.set('threshold', String(threshold));
      params.set('page_size', '200');
      if (seasonId != null) params.set('season', String(seasonId));

      const { data } = await api.get<IApiListResponse<IOverdueShipment>>(
        `/export/shipments/overdue/?${params.toString()}`,
      );
      return data;
    },
    enabled: USE_MOCK || isReady,
    staleTime: 60_000,
  });
}
