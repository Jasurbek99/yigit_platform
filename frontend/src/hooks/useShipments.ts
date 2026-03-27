import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHIPMENTS_RESPONSE } from '@/mock/shipments';
import type { IApiListResponse, IShipmentListItem } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export interface IShipmentFilters {
  page?: number;
  page_size?: number;
  status?: number;
  country?: number;
  my_work?: boolean;
  search?: string;
}

export function useShipments(filters: IShipmentFilters = {}) {
  return useQuery({
    queryKey: ['shipments', filters],
    queryFn: async (): Promise<IApiListResponse<IShipmentListItem>> => {
      if (USE_MOCK) return MOCK_SHIPMENTS_RESPONSE;

      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.page_size) params.set('page_size', String(filters.page_size));
      if (filters.status) params.set('status', String(filters.status));
      if (filters.country) params.set('country', String(filters.country));
      if (filters.my_work) params.set('my_work', 'true');
      if (filters.search) params.set('search', filters.search);

      const { data } = await api.get<IApiListResponse<IShipmentListItem>>(
        `/export/shipments/?${params.toString()}`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}
