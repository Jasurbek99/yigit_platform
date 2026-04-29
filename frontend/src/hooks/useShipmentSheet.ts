import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import type {
  IShipmentSheetItem,
  IShipmentSheetResponse,
  ISheetCommentCounts,
  ISheetTaskCounts,
} from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

interface IShipmentSheetResult {
  shipments: IShipmentSheetItem[];
  comment_counts: ISheetCommentCounts;
  task_counts: ISheetTaskCounts;
}

export function useShipmentSheet() {
  return useQuery({
    queryKey: ['shipments', 'sheet'],
    queryFn: async (): Promise<IShipmentSheetResult> => {
      if (USE_MOCK) {
        return {
          shipments: MOCK_SHEET_DATA,
          comment_counts: {},
          task_counts: {},
        };
      }

      const { data } = await api.get<IShipmentSheetResponse>('/export/shipments/sheet/');
      return {
        shipments: data.results,
        comment_counts: data.comment_counts ?? {},
        task_counts: data.task_counts ?? {},
      };
    },
    staleTime: 30_000,
  });
}
