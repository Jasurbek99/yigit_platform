import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse, ISalesRepShipment } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const EMPTY_RESPONSE: IApiListResponse<ISalesRepShipment> = {
  count: 0,
  next: null,
  previous: null,
  results: [],
};

export function useMySalesReports(needsReport: boolean) {
  return useQuery({
    queryKey: ['shipments', 'my-sales-reports', needsReport],
    queryFn: async (): Promise<IApiListResponse<ISalesRepShipment>> => {
      if (USE_MOCK) return EMPTY_RESPONSE;

      const params = new URLSearchParams();
      params.set('needs_report', String(needsReport));
      params.set('page_size', '200');

      const { data } = await api.get<IApiListResponse<ISalesRepShipment>>(
        `/export/shipments/my-sales-reports/?${params.toString()}`,
      );
      return data;
    },
    staleTime: 60_000,
  });
}
