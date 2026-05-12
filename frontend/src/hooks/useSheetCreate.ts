import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';

/**
 * Sheet "+" button — creates a new shipment as a DRAFT.
 *
 * The backend auto-generates cargo_code (DDMMNNN/YY) when omitted and
 * defaults date to today. Soltanmyrat fills in his physical pallet code
 * (official_export_code) later via the Sheet/Detail edit paths; the
 * shipment date can be edited too.
 *
 * Shipments NEVER start in Loading. They start in Draft and are
 * promoted to Loading from the Detail page once prep is done.
 */
export function useSheetCreate() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/export/shipments/', {
        is_draft: true,
        block_sources: [],
      });
      return data;
    },
    onSuccess: () => {
      toast.success(t('sheet.create_success'));
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err: unknown) => {
      const apiErr = err as { response?: { data?: { error?: string } } };
      const detail = apiErr?.response?.data;
      toast.error(detail?.error ?? t('sheet.create_error'));
    },
  });
}
