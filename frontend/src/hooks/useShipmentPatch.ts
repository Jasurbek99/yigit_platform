import { useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import type { IApiListResponse, IShipmentListItem, IShipmentSheetItem } from '@/types';

interface IPatchVariables {
  id: number;
  field: string;
  value: unknown;
}

interface IPatchContext {
  previousSheet: IShipmentSheetItem[] | undefined;
  previousLists: [readonly unknown[], IApiListResponse<IShipmentListItem> | undefined][];
}

const isListQueryKey = (key: readonly unknown[]): boolean =>
  key[0] === 'shipments' && typeof key[1] === 'object' && key[1] !== null;

export function useShipmentPatch() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<unknown, unknown, IPatchVariables, IPatchContext>({
    mutationFn: async ({ id, field, value }) => {
      const { data } = await api.patch(`/export/shipments/${id}/`, { [field]: value });
      return data;
    },
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: ['shipments'] });

      const previousSheet = queryClient.getQueryData<IShipmentSheetItem[]>(['shipments', 'sheet']);
      queryClient.setQueryData<IShipmentSheetItem[]>(['shipments', 'sheet'], (old) =>
        old?.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
      );

      const previousLists = queryClient.getQueriesData<IApiListResponse<IShipmentListItem>>({
        predicate: (q) => isListQueryKey(q.queryKey),
      });
      queryClient.setQueriesData<IApiListResponse<IShipmentListItem>>(
        { predicate: (q) => isListQueryKey(q.queryKey) },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            results: old.results.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
          };
        },
      );

      return { previousSheet, previousLists };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSheet !== undefined) {
        queryClient.setQueryData(['shipments', 'sheet'], context.previousSheet);
      }
      context?.previousLists.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      message.error(t('sheet.save_error'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}
