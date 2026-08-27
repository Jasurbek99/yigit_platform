import { useCallback } from 'react';
import { Modal } from 'antd';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { ISheetRowSetting } from '@/types';
import {
  useSaveSheetRowSetting,
  type IVersionConflictError,
} from '@/hooks/useSheetRowSettings';
import { draftPatch, type ISheetRowDraft } from './rowDraft';

/**
 * Saves a whole row draft as ONE PATCH carrying every changed setting. The
 * PATCH bumps `version` and the hook invalidates the list on success, so a
 * second mutation fired from the same user action would carry a stale version
 * and 409 — everything the panel edits must travel in this single call.
 */
export function useSaveRowDraft() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveRow = useSaveSheetRowSetting();

  const save = useCallback(
    async (record: ISheetRowSetting, draft: ISheetRowDraft): Promise<boolean> => {
      const patch = draftPatch(record, draft);

      if (Object.keys(patch).length > 0) {
        try {
          await saveRow.mutateAsync({ id: record.id, version: record.version, ...patch });
        } catch (err) {
          const axiosErr = err as AxiosError<IVersionConflictError>;
          if (axiosErr.response?.status === 409) {
            Modal.confirm({
              title: t('sheet_rows.conflict_title'),
              content: t('sheet_rows.conflict_message'),
              okText: t('sheet_rows.conflict_refresh'),
              cancelButtonProps: { style: { display: 'none' } },
              onOk: () => {
                queryClient.invalidateQueries({ queryKey: ['admin', 'sheet-rows'] });
              },
            });
          } else {
            toast.error(t('shipment_settings.toast_error'));
          }
          return false;
        }
      }

      toast.success(t('sheet_rows.toast_saved'));
      return true;
    },
    [saveRow, queryClient, t],
  );

  return { save, isPending: saveRow.isPending };
}
