import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import type { IShipmentSheetItem } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export function useShipmentSheet() {
  return useQuery({
    queryKey: ['shipments', 'sheet'],
    queryFn: async (): Promise<IShipmentSheetItem[]> => {
      if (USE_MOCK) return MOCK_SHEET_DATA;

      const { data } = await api.get<IShipmentSheetItem[]>('/export/shipments/sheet/');
      return data;
    },
    staleTime: 30_000,
  });
}
