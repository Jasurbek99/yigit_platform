import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHEET_DATA, MOCK_ROW_SETTINGS, MOCK_USERS_INDEX } from '@/mock/shipmentSheet';
import type {
  IShipmentSheetItem,
  IShipmentSheetResponse,
  ISheetCommentCounts,
  ISheetTaskCounts,
  ISheetRowSettingForUser,
  IRowConfig,
} from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

interface IShipmentSheetResult {
  shipments: IShipmentSheetItem[];
  comment_counts: ISheetCommentCounts;
  task_counts: ISheetTaskCounts;
  rows: IRowConfig[];
  row_settings: Record<string, ISheetRowSettingForUser>;
  last_edits: Record<string, Record<string, import('@/types').ICellLastEdit>>;
  users_index: Record<string, { name: string; role: string | null }>;
  current_user_id: number;
  current_user_lang: 'tk' | 'ru' | 'en';
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
          rows: [],
          row_settings: MOCK_ROW_SETTINGS,
          last_edits: {},
          users_index: MOCK_USERS_INDEX,
          current_user_id: 1,
          current_user_lang: 'ru',
        };
      }

      const { data } = await api.get<IShipmentSheetResponse>('/export/shipments/sheet/');
      return {
        shipments: data.results,
        comment_counts: data.comment_counts ?? {},
        task_counts: data.task_counts ?? {},
        rows: data.rows ?? [],
        row_settings: data.row_settings ?? {},
        last_edits: data.last_edits ?? {},
        users_index: data.users_index ?? {},
        current_user_id: data.current_user_id,
        current_user_lang: data.current_user_lang ?? 'tk',
      };
    },
    staleTime: 30_000,
  });
}
