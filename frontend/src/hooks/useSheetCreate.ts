import { useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import api from '@/services/api';

/**
 * Generates a cargo code in DDMMSEQ/YY format.
 * DD = day, MM = month (2 digits), SEQ = 3-digit sequence, YY = year.
 * The sequence part is a random 3-digit number to avoid collisions
 * — the backend validates uniqueness and rejects duplicates.
 */
function generateCargoCode(): string {
  const now = dayjs();
  const dd = now.format('DD');
  const mm = now.format('MM');
  const yy = now.format('YY');
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `${dd}${mm}${seq}/${yy}`;
}

export function useSheetCreate() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async () => {
      const cargoCode = generateCargoCode();
      const date = dayjs().format('YYYY-MM-DD');
      const { data } = await api.post('/export/shipments/', {
        cargo_code: cargoCode,
        date,
      });
      return data;
    },
    onSuccess: () => {
      message.success(t('sheet.create_success'));
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
    onError: (err: unknown) => {
      const apiErr = err as { response?: { data?: { error?: string; cargo_code?: string[] } } };
      const detail = apiErr?.response?.data;
      // If cargo code collision, retry silently
      if (detail?.cargo_code?.some((m) => m.includes('already exists'))) {
        message.info(t('sheet.create_retry'));
        return;
      }
      message.error(detail?.error ?? t('sheet.create_error'));
    },
  });
}
