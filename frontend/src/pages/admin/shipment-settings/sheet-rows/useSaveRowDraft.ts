import { useCallback } from 'react';
import { Modal } from 'antd';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { ISheetRowSetting } from '@/types';
import {
  useSaveSheetRowSetting,
  useBulkPermissions,
  type IVersionConflictError,
} from '@/hooks/useSheetRowSettings';
import { draftPatch, userDiff, type ISheetRowDraft } from './rowDraft';

/**
 * Saves a whole row draft: one PATCH with every changed setting, then — only
 * if the extra-user list changed — the separate `permissions/bulk/` call that
 * owns SheetRowUserPermission rows. Sequential on purpose: the PATCH bumps
 * `version`, so nothing else may be in flight beside it, and a failure in the
 * second step must not be reported as a clean save.
 */
export function useSaveRowDraft() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveRow = useSaveSheetRowSetting();
  const bulkPermissions = useBulkPermissions();

  const save = useCallback(
    async (record: ISheetRowSetting, draft: ISheetRowDraft): Promise<boolean> => {
      const patch = draftPatch(record, draft);
      const { grants, revokes } = userDiff(record, draft);

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

      if (grants.length > 0 || revokes.length > 0) {
        try {
          await bulkPermissions.mutateAsync({ row_id: record.id, grants, revokes });
        } catch {
          toast.error(t('sheet_rows.toast_saved_perm_error'));
          return false;
        }
      }

      toast.success(t('sheet_rows.toast_saved'));
      return true;
    },
    [saveRow, bulkPermissions, queryClient, t],
  );

  return { save, isPending: saveRow.isPending || bulkPermissions.isPending };
}
