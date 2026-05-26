import { memo, useCallback } from 'react';
import { Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { IShipmentSheetItem, IRowConfig, ICommentTaskStatus, ISheetRowSettingForUser } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { scaleSheetLayout } from '@/constants/sheetRowConfig';
import { CommentMarker } from './CommentMarker';
import { getCellValue } from './getCellValue';

// Re-export for consumers that only need the formatter (e.g. test files).
export { getCellValue } from './getCellValue';

const COUNTRY_FLAGS: Record<string, string> = {
  KZ: '🇰🇿', RU: '🇷🇺', BY: '🇧🇾', KG: '🇰🇬', TJ: '🇹🇯', UZ: '🇺🇿', AF: '🇦🇫',
};

interface ISheetCellProps {
  shipment: IShipmentSheetItem;
  rowConfig: IRowConfig;
  isEditable: boolean;
  commentCount?: number;
  commentTaskState?: ICommentTaskStatus | null;
  rowSetting?: ISheetRowSettingForUser;
}

function isEmpty(value: string): boolean {
  return !value || value === '—';
}

function SheetCellInner({ shipment, rowConfig, isEditable, commentCount = 0, commentTaskState = null, rowSetting }: ISheetCellProps) {
  const navigate = useNavigate();
  // Granular store selectors — NEVER `useSheetStore()` without a selector here.
  // The grid renders hundreds of cells; a bare subscription re-renders every
  // cell on any store change (cell click, search keystroke, drawer toggle),
  // which defeats the surrounding memo(). Setters are stable refs (no
  // re-render); `isActive` is a derived primitive so only the two cells whose
  // active state actually flips re-render on selection.
  const setActiveCell = useSheetStore((s) => s.setActiveCell);
  const setEditingCell = useSheetStore((s) => s.setEditingCell);
  const openCommentsForCell = useSheetStore((s) => s.openCommentsForCell);
  const sheetZoom = useSheetStore((s) => s.sheetZoom);
  const reorderMode = useSheetStore((s) => s.reorderMode);
  const isActive = useSheetStore(
    (s) => s.activeCell?.shipmentId === shipment.id && s.activeCell?.rowKey === rowConfig.field_key,
  );
  const isGapy = shipment.is_gapy_satys;
  const isHidden = rowConfig.gapy_hidden && isGapy;

  const { colShipment: COL_WIDTH_SHIPMENT, rowHeight: ROW_HEIGHT } = scaleSheetLayout(sheetZoom);

  // Per-row style overrides from admin sheet-row settings. A custom px width is
  // itself scaled by zoom so it tracks its (scaled) column slot in SheetGrid.
  const cellWidth = rowSetting?.style?.width
    ? Math.round(rowSetting.style.width * sheetZoom)
    : COL_WIDTH_SHIPMENT;
  const cellAlign = rowSetting?.style?.align;
  const cellBg = rowSetting?.style?.color ?? undefined;

  const value = getCellValue(shipment, rowConfig);
  const cellIsEmpty = isEmpty(value);

  const handleClick = useCallback(() => {
    // Editing is locked while reorder mode is active — clicks should not
    // activate or enter edit mode on any cell.
    if (reorderMode) return;
    // Empty editable cells → edit immediately on single click
    if (isEditable && !isHidden && cellIsEmpty) {
      setEditingCell({ shipmentId: shipment.id, rowKey: rowConfig.field_key });
      return;
    }
    setActiveCell({ shipmentId: shipment.id, rowKey: rowConfig.field_key });
  }, [reorderMode, isEditable, isHidden, cellIsEmpty, setActiveCell, setEditingCell, shipment.id, rowConfig.field_key]);

  const handleDoubleClick = useCallback(() => {
    // Editing locked while reorder mode is active
    if (reorderMode) return;
    // Filled editable cells → edit on double click
    if (isEditable && !isHidden && !cellIsEmpty) {
      setEditingCell({ shipmentId: shipment.id, rowKey: rowConfig.field_key });
    }
  }, [reorderMode, isEditable, isHidden, cellIsEmpty, setEditingCell, shipment.id, rowConfig.field_key]);

  if (isHidden) {
    return (
      <div className="sheet-cell sheet-cell--gapy-hidden" style={{ width: cellWidth, height: ROW_HEIGHT }}>
        —
      </div>
    );
  }

  // Special rendering
  const { field_key: fieldKey } = rowConfig;

  // Country with flag
  if (fieldKey === 'country' && shipment.country_code) {
    const flag = COUNTRY_FLAGS[shipment.country_code] ?? '';
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...(cellBg ? { backgroundColor: cellBg } : {}), ...(cellAlign ? { textAlign: cellAlign } : {}) }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <span className="sheet-cell__country">
          {flag} {shipment.country_name}
        </span>
      </div>
    );
  }

  // Firm splits as tags
  if (fieldKey === 'firm_splits' && shipment.firm_splits.length > 0) {
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...(cellBg ? { backgroundColor: cellBg } : {}) }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="sheet-cell__tags">
          {shipment.firm_splits.map((f) => (
            <Tag
              key={f.firm_code}
              color={shipment.firm_splits.length > 1 ? 'purple' : undefined}
              style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
            >
              {f.firm_code}
            </Tag>
          ))}
        </div>
      </div>
    );
  }

  // Block sources as tags
  if (fieldKey === 'block_sources' && shipment.block_sources.length > 0) {
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...(cellBg ? { backgroundColor: cellBg } : {}) }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="sheet-cell__tags">
          {shipment.block_sources.map((b) => (
            <Tag key={b.block_code} color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
              {b.block_code}
            </Tag>
          ))}
        </div>
      </div>
    );
  }

  // Doc-advance flag (R24) — read-only ✓/❌; click jumps to AdvancesTracker filtered to this shipment
  if (fieldKey === 'has_doc_advance') {
    const handleAdvanceClick = () => {
      navigate(`/export/advances?shipment=${shipment.id}`);
    };
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style} sheet-cell--linkable${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, cursor: 'pointer', ...(cellBg ? { backgroundColor: cellBg } : {}) }}
        onClick={handleAdvanceClick}
      >
        <span style={{ color: shipment.has_doc_advance ? '#067647' : '#b42318', fontWeight: 600 }}>
          {value}
        </span>
      </div>
    );
  }

  // Report status
  if (fieldKey === 'has_sales_report') {
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...(cellBg ? { backgroundColor: cellBg } : {}) }}
        onClick={handleClick}
      >
        <span style={{ color: shipment.has_sales_report ? '#067647' : '#b42318', fontWeight: 600 }}>
          {value}
        </span>
      </div>
    );
  }

  // Cargo code (key field)
  if (fieldKey === 'cargo_code') {
    return (
      <div
        className={`sheet-cell sheet-cell--key${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...(cellBg ? { backgroundColor: cellBg } : {}) }}
        onClick={handleClick}
      >
        <span className="sheet-cell__code">{shipment.cargo_code}</span>
      </div>
    );
  }

  // Default rendering.
  // Native `title` (not antd <Tooltip>) for the truncation hint: the grid mounts
  // ~900 cells at once and remounts columns on every horizontal scroll step.
  // An antd Tooltip per cell (rc-trigger + portal + align observers) was the
  // dominant scroll-jank cost; the browser-native title is zero React overhead.
  return (
    <div
      className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isEditable ? ' sheet-cell--editable' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
      style={{ width: cellWidth, height: ROW_HEIGHT, position: 'relative', ...(cellBg ? { backgroundColor: cellBg } : {}) }}
      title={value.length > 15 ? value : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <span className="sheet-cell__text" style={cellAlign ? { textAlign: cellAlign, display: 'block' } : undefined}>{value}</span>
      <CommentMarker
        count={commentCount}
        taskState={commentTaskState}
        showHoverHint
        onClick={() => openCommentsForCell(shipment.id, rowConfig.field_key)}
      />
    </div>
  );
}

export const SheetCell = memo(SheetCellInner);
