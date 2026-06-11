import { useState } from 'react';
import { Popover, Button, Divider, Modal } from 'antd';
import { SettingOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import type { ISheetRowSettingForUser } from '@/types';
import {
  useSaveSheetRowSetting,
  type ISaveSheetRowPayload,
  type IVersionConflictError,
} from '@/hooks/useSheetRowSettings';
import { SheetRowStyleControls, type ISheetRowStyleValues } from './SheetRowStyleControls';

interface ISheetRowSettingsPopoverProps {
  /** Per-row settings from the /sheet/ payload (holds id, version, nested style). */
  setting: ISheetRowSettingForUser;
  /** Privileged gate (admin/director/export_manager/superuser) for STYLE editing. */
  canEditStyle: boolean;
  /** Per-user hide-row action. Undefined = hide not available for this row. */
  onHideRow?: () => void;
}

/**
 * Per-row gear menu in the Sheet's label band (Col C). Replaces the old
 * kebab "…" hide-only button. Opens a popover that — for privileged users —
 * exposes the full row style controls (font weight/style/family/size, width,
 * alignment, background + font colors) editable in-place, plus the per-user
 * "Hide row" action available to everyone.
 *
 * Style edits PATCH the SheetRowSetting admin endpoint via
 * `useSaveSheetRowSetting`, which invalidates the live `['shipments','sheet']`
 * query so the change reflects immediately (and `version` refreshes for the
 * next edit). A stale-version 409 prompts a refresh.
 */
export function SheetRowSettingsPopover({
  setting,
  canEditStyle,
  onHideRow,
}: ISheetRowSettingsPopoverProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveRow = useSaveSheetRowSetting();
  const [open, setOpen] = useState(false);

  // Style editing requires a backing SheetRowSetting row id (PATCH key). Fallback
  // rows (no DB config) have id === null — they get the hide action only.
  const canStyle = canEditStyle && setting.id !== null;

  // Map the compact nested /sheet/ style object → the flat shape the shared
  // controls + the admin PATCH payload both use.
  const values: ISheetRowStyleValues = {
    style_color: setting.style?.color ?? null,
    style_font_color: setting.style?.font_color ?? null,
    style_font_weight: setting.style?.font_weight ?? '',
    style_font_style: setting.style?.font_style ?? '',
    style_font_family: setting.style?.font_family ?? '',
    style_font_size: setting.style?.font_size ?? null,
  };

  const handleSave = (patch: Partial<ISaveSheetRowPayload>): void => {
    if (!canStyle || setting.id === null || setting.version === null) return;
    saveRow.mutate(
      { id: setting.id, version: setting.version, ...patch },
      {
        onError: (err: AxiosError<IVersionConflictError>) => {
          if (err.response?.status === 409) {
            Modal.confirm({
              title: t('sheet_rows.conflict_title'),
              content: t('sheet_rows.conflict_message'),
              okText: t('sheet_rows.conflict_refresh'),
              cancelButtonProps: { style: { display: 'none' } },
              onOk: () => {
                queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
              },
            });
          } else {
            toast.error(t('shipment_settings.toast_error'));
          }
        },
      },
    );
  };

  const content = (
    <div style={{ width: 240 }}>
      {canStyle && (
        <>
          <SheetRowStyleControls values={values} canWrite onSave={handleSave} />
          {onHideRow && <Divider style={{ margin: '10px 0' }} />}
        </>
      )}
      {onHideRow && (
        <Button
          block
          size="small"
          icon={<EyeInvisibleOutlined />}
          onClick={() => {
            setOpen(false);
            onHideRow();
          }}
        >
          {t('sheet.hide_row')}
        </Button>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      title={t('sheet.row_settings')}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
    >
      <button
        className="sheet-row-kebab"
        aria-label={t('sheet.row_settings')}
        title={t('sheet.row_settings')}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          padding: '2px 3px',
          lineHeight: 1,
          color: '#8c8c8c',
          fontSize: 12,
          flexShrink: 0,
          borderRadius: 2,
        }}
      >
        <SettingOutlined />
      </button>
    </Popover>
  );
}
