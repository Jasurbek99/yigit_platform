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

interface IPatchMultiVariables {
  id: number;
  fields: Record<string, unknown>;
}

interface IPatchContext {
  previousSheet: IShipmentSheetItem[] | undefined;
  previousLists: [readonly unknown[], IApiListResponse<IShipmentListItem> | undefined][];
}

const isListQueryKey = (key: readonly unknown[]): boolean =>
  key[0] === 'shipments' && typeof key[1] === 'object' && key[1] !== null;

function applyOptimistic(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  fields: Record<string, unknown>,
): IPatchContext {
  const previousSheet = queryClient.getQueryData<IShipmentSheetItem[]>(['shipments', 'sheet']);
  queryClient.setQueryData<IShipmentSheetItem[]>(['shipments', 'sheet'], (old) =>
    old?.map((s) => (s.id === id ? { ...s, ...fields } : s)),
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
        results: old.results.map((s) => (s.id === id ? { ...s, ...fields } : s)),
      };
    },
  );

  return { previousSheet, previousLists };
}

function rollback(
  queryClient: ReturnType<typeof useQueryClient>,
  context: IPatchContext | undefined,
): void {
  if (!context) return;
  if (context.previousSheet !== undefined) {
    queryClient.setQueryData(['shipments', 'sheet'], context.previousSheet);
  }
  context.previousLists.forEach(([key, data]) => {
    queryClient.setQueryData(key, data);
  });
}

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
      return applyOptimistic(queryClient, id, { [field]: value });
    },
    onError: (_err, _vars, context) => {
      rollback(queryClient, context);
      message.error(t('sheet.save_error'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}

/**
 * Multi-field PATCH on a single shipment. One request, one optimistic update
 * keyed by id. Used by the web-management Edit Drawer (Detail and List rows).
 */
export function useShipmentPatchMulti() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<unknown, unknown, IPatchMultiVariables, IPatchContext>({
    mutationFn: async ({ id, fields }) => {
      const { data } = await api.patch(`/export/shipments/${id}/`, fields);
      return data;
    },
    onMutate: async ({ id, fields }) => {
      await queryClient.cancelQueries({ queryKey: ['shipments'] });
      return applyOptimistic(queryClient, id, fields);
    },
    onError: (_err, _vars, context) => {
      rollback(queryClient, context);
      message.error(t('shipment_edit_drawer.save_error'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
    },
  });
}
