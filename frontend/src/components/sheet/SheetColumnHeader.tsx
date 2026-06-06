import { memo, useCallback } from 'react';
import { ColorPicker, Modal } from 'antd';
import { DeleteOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import type { Color } from 'antd/es/color-picker';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useSetColumnColor, useSoftDeleteShipment } from '@/hooks/useShipments';

interface ISheetColumnHeaderProps {
  shipmentId: number;
  seqNumber: number;
  /**
   * The cargo_code is kept on the prop name `exportCode` for back-compat
   * with the confirm dialog (used in the soft-delete prompt). It is no
   * longer rendered in the header — the header shows `officialExportCode`
   * instead. cargo_code still appears as a normal data row (row 7) so it
   * remains visible in the table.
   */
  exportCode: string;
  /**
   * Operator-entered "Export code" (Soltanmyrat's pallet tag). Displayed in
   * the column header when filled; when null the header shows only the seq.
   */
  officialExportCode: string | null;
  columnColor: string | null;
  /** When true, the shipment is cancelled — strike the code + show a red tag. */
  isCancelled?: boolean;
}

const PRESET_COLORS = [
  '#fee2e2', '#fef3c7', '#fef9c3', '#dcfce7', '#dbeafe',
  '#e0e7ff', '#fce7f3', '#f3e8ff', '#e5e7eb', '#fed7aa',
];

function SheetColumnHeaderInner({
  shipmentId,
  seqNumber,
  exportCode,
  officialExportCode,
  columnColor,
  isCancelled = false,
}: ISheetColumnHeaderProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Column tint and soft-delete are open to every authenticated viewer of the
  // Sheet — the Sheet page itself is the only access gate. Column color goes
  // through a dedicated endpoint (not shipment PATCH) so it doesn't require
  // shipment.can_edit on the viewset.
  const canPaint = !!user;
  const canSoftDelete = !!user;
  const setColumnColor = useSetColumnColor();
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
      setColumnColor.mutate({ id: shipmentId, color: hex });
    },
    [setColumnColor, shipmentId],
  );

  const handleClear = useCallback(() => {
    setColumnColor.mutate({ id: shipmentId, color: null });
  }, [setColumnColor, shipmentId]);

  return (
    <>
      <span className="sheet-col-header__seq">{seqNumber}</span>
      {officialExportCode ? (
        <span
          className={`sheet-col-header__code${isCancelled ? ' sheet-col-header__code--cancelled' : ''}`}
        >
          {officialExportCode}
        </span>
      ) : null}
      {isCancelled && (
        <span className="sheet-col-header__cancel-tag">
          {t('shipment_status.cancelled')}
        </span>
      )}
      {canSoftDelete && (
        <button
          type="button"
          className="sheet-col-header__delete-btn"
          title={t('shipment_soft_delete.btn')}
          onClick={handleSoftDelete}
        >
          <DeleteOutlined />
        </button>
      )}
      {canPaint && (
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
