import { useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import type { IShipmentSheetItem } from '@/types';

interface IPatchVariables {
  id: number;
  field: string;
  value: unknown;
}

export function useShipmentPatch() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({ id, field, value }: IPatchVariables) => {
      const { data } = await api.patch(`/export/shipments/${id}/`, { [field]: value });
      return data;
    },
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: ['shipments', 'sheet'] });

      const previous = queryClient.getQueryData<IShipmentSheetItem[]>(['shipments', 'sheet']);

      queryClient.setQueryData<IShipmentSheetItem[]>(['shipments', 'sheet'], (old) => {
        if (!old) return old;
        return old.map((s) =>
          s.id === id ? { ...s, [field]: value } : s,
        );
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['shipments', 'sheet'], context.previous);
      }
      message.error(t('sheet.save_error'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}
