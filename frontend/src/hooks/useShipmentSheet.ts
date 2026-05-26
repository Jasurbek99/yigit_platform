import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
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

/** The TanStack Query key for the sheet endpoint — exported so callers can invalidate it. */
export const SHEET_QUERY_KEY = ['shipments', 'sheet'] as const;

/**
 * POST /export/shipments/sheet-order/
 * Saves the global left-to-right column order for all users.
 * On success: invalidates the sheet query so the next render reflects
 * the server-confirmed order and the optimistic override can be cleared.
 */
export function useSaveSheetColumnOrder() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<{ updated: number }, Error, { shipment_ids: number[] }>({
    mutationFn: async (body) => {
      const { data } = await api.post<{ updated: number }>(
        '/export/shipments/sheet-order/',
        body,
      );
      return data;
    },
    onSuccess: () => {
      // Refetch canonical order — the backend now sorts by sheet_position.
      // The optimistic columnOrder in the store is cleared by ShipmentSheet
      // after the query settles (the refetched data becomes the truth).
      void queryClient.invalidateQueries({ queryKey: SHEET_QUERY_KEY });
      toast.success(t('sheet.reorder_columns_saved'));
    },
    onError: () => {
      toast.error(t('sheet.reorder_columns_error'));
    },
  });
}

export function useShipmentSheet() {
  return useQuery({
    queryKey: SHEET_QUERY_KEY,
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
