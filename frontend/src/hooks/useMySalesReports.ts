import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { IApiListResponse, ISalesRepShipment } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const EMPTY_RESPONSE: IApiListResponse<ISalesRepShipment> = {
  count: 0,
  next: null,
  previous: null,
  results: [],
};

export function useMySalesReports(needsReport: boolean) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['shipments', 'my-sales-reports', seasonId, needsReport],
    queryFn: async (): Promise<IApiListResponse<ISalesRepShipment>> => {
      if (USE_MOCK) return EMPTY_RESPONSE;

      const params = new URLSearchParams();
      params.set('needs_report', String(needsReport));
      params.set('page_size', '200');
      if (seasonId != null) params.set('season', String(seasonId));

      const { data } = await api.get<IApiListResponse<ISalesRepShipment>>(
        `/export/shipments/my-sales-reports/?${params.toString()}`,
      );
      return data;
    },
    enabled: USE_MOCK || isReady,
    staleTime: 60_000,
  });
}
