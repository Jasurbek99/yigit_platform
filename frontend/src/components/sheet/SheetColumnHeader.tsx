import { memo, useCallback } from 'react';
import { ColorPicker, Modal } from 'antd';
import { DeleteOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import type { Color } from 'antd/es/color-picker';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { canEditField } from '@/utils/permissions';
import { useShipmentPatch } from '@/hooks/useShipmentPatch';
import { useSoftDeleteShipment } from '@/hooks/useShipments';

interface ISheetColumnHeaderProps {
  shipmentId: number;
  seqNumber: number;
  exportCode: string;
  columnColor: string | null;
  /** When true, the shipment is cancelled — strike the code + show a red tag. */
  isCancelled?: boolean;
  /**
   * When true (reorder mode), the color picker dot is hidden so the entire
   * header surface is safely draggable without interfering with picker clicks.
   */
  hideColorPicker?: boolean;
}

const PRESET_COLORS = [
  '#fee2e2', '#fef3c7', '#fef9c3', '#dcfce7', '#dbeafe',
  '#e0e7ff', '#fce7f3', '#f3e8ff', '#e5e7eb', '#fed7aa',
];

function SheetColumnHeaderInner({
  shipmentId,
  seqNumber,
  exportCode,
  columnColor,
  isCancelled = false,
  hideColorPicker = false,
}: ISheetColumnHeaderProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canPaint = canEditField(user, 'shipment', 'column_color');
  const canSoftDelete = !!user && (user.is_superuser || user.role === 'admin');
  const patch = useShipmentPatch();
  const softDelete = useSoftDeleteShipment();

  const handleSoftDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      Modal.confirm({
        title: t('shipment_soft_delete.confirm_title', { code: exportCode }),
        icon: <ExclamationCircleFilled style={{ color: '#faad14' }} />,
        content: t('shipment_soft_delete.confirm_content'),
        okText: t('shipment_soft_delete.confirm_ok'),
        okType: 'danger',
        cancelText: t('common.cancel'),
        async onOk() {
          try {
            await softDelete.mutateAsync({ id: shipmentId });
            toast.success(t('shipment_soft_delete.success', { code: exportCode }));
          } catch (err) {
            console.error('[SheetColumnHeader] soft delete failed', err);
            toast.error(t('shipment_soft_delete.error'));
          }
        },
      });
    },
    [exportCode, shipmentId, softDelete, t],
  );

  const handleChange = useCallback(
    (color: Color) => {
      // Strip alpha if the user dragged the opacity slider. `disabledAlpha` on
      // the picker should prevent this, but older Ant builds still emit
      // 8-char `#RRGGBBAA` from `toHexString()` — and the backend column is
      // `CharField(max_length=7)`. Truncate defensively. The tint is applied
      // at 18% via color-mix anyway, so user-chosen opacity is redundant.
      const hex = color.toHexString().slice(0, 7);
      patch.mutate({ id: shipmentId, field: 'column_color', value: hex });
    },
    [patch, shipmentId],
  );

  const handleClear = useCallback(() => {
    patch.mutate({ id: shipmentId, field: 'column_color', value: null });
  }, [patch, shipmentId]);

  return (
    <>
      <span className="sheet-col-header__seq">{seqNumber}</span>
      <span
        className={`sheet-col-header__code${isCancelled ? ' sheet-col-header__code--cancelled' : ''}`}
      >
        {exportCode}
      </span>
      {isCancelled && (
        <span className="sheet-col-header__cancel-tag">
          {t('shipment_status.cancelled')}
        </span>
      )}
      {canSoftDelete && !hideColorPicker && (
        <button
          type="button"
          className="sheet-col-header__delete-btn"
          title={t('shipment_soft_delete.btn')}
          onClick={handleSoftDelete}
        >
          <DeleteOutlined />
        </button>
      )}
      {canPaint && !hideColorPicker && (
        <ColorPicker
          value={columnColor ?? undefined}
          onChangeComplete={handleChange}
          onClear={handleClear}
          allowClear
          disabledAlpha
          size="small"
          presets={[{ label: t('sheet.column_color.presets'), colors: PRESET_COLORS }]}
          rootClassName="sheet-col-header__color-popover"
        >
          <button
            type="button"
            className="sheet-col-header__color-dot"
            title={t('sheet.column_color.tooltip')}
            style={columnColor ? { background: columnColor } : undefined}
            onClick={(e) => e.stopPropagation()}
          />
        </ColorPicker>
      )}
    </>
  );
}

export const SheetColumnHeader = memo(SheetColumnHeaderInner);
