import { memo, useCallback, useState } from 'react';
import { Dropdown, Modal, Tag } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem, IRowConfig, ICommentTaskStatus, ISheetRowSettingForUser, IShipmentOptionType } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useShipmentOptions } from '@/hooks/useAdmin';
import { scaleSheetLayout } from '@/constants/sheetRowConfig';
import { useSheetCellWrite, isClearableField } from '@/hooks/useSheetCellWrite';
import { CommentMarker } from './CommentMarker';
import { FieldHistoryContent } from './CellLastEditMarker';
import { getCellValue } from './getCellValue';
import { getContrastTextColor } from '@/utils/contrastColor';

// Re-export for consumers that only need the formatter (e.g. test files).
export { getCellValue } from './getCellValue';

const COUNTRY_FLAGS: Record<string, string> = {
  KZ: '🇰🇿', RU: '🇷🇺', BY: '🇧🇾', KG: '🇰🇬', TJ: '🇹🇯', UZ: '🇺🇿', AF: '🇦🇫',
};

// Maps the admin-stored font-family key (SheetRowSetting.style_font_family) to a
// concrete CSS stack. Keys are a controlled allowlist on the backend so the
// client never receives an arbitrary font the user's machine may lack.
const SHEET_FONT_FAMILY: Record<string, string> = {
  dm_sans: "'DM Sans', sans-serif",
  inter: "'Inter', sans-serif",
  mono: "ui-monospace, 'Cascadia Code', 'Roboto Mono', monospace",
  serif: "Georgia, 'Times New Roman', serif",
};

// Sheet fields whose value is a code from ShipmentOptionType. When admin sets
// a per-option color on the matching option, the cell paints with that color
// (Google-Sheets-style conditional formatting on dropdown values).
const FIELD_KEY_TO_OPTION_CATEGORY: Record<string, string> = {
  harvest_status: 'harvest_status',
  documents_status: 'documents_status',
  vehicle_condition: 'vehicle_condition',
  vehicle_responsible: 'transport_responsible',
};

// Single-FK dropdown fields → the matching `*_color` field embedded by the
// backend ShipmentSheetSerializer. Admin sets the color on the FK row
// (Country.color, Customer.color, etc.) and it travels with every shipment.
const FIELD_KEY_TO_FK_COLOR_FIELD: Record<string, keyof IShipmentSheetItem> = {
  country: 'country_color',
  city: 'city_color',
  customer: 'customer_color',
  import_firm: 'import_firm_color',
  variety: 'variety_color',
  border_point: 'border_point_color',
};

function getCellAutoColor(
  fieldKey: string,
  shipment: IShipmentSheetItem,
  options: IShipmentOptionType[] | undefined,
): string | null {
  // 1. Reference-FK color (country/customer/city/import_firm/variety/border_point).
  const fkColorKey = FIELD_KEY_TO_FK_COLOR_FIELD[fieldKey];
  if (fkColorKey) {
    const fkColor = shipment[fkColorKey];
    if (typeof fkColor === 'string' && fkColor) return fkColor;
  }
  // 2. ShipmentOptionType color (harvest_status, documents_status,
  //    vehicle_condition, vehicle_responsible).
  if (!options) return null;
  const category = FIELD_KEY_TO_OPTION_CATEGORY[fieldKey];
  if (!category) return null;
  const raw = shipment[fieldKey as keyof IShipmentSheetItem];
  if (typeof raw !== 'string' || !raw) return null;
  const match = options.find((o) => o.category === category && o.code === raw);
  return match?.color ?? null;
}

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
  const { t } = useTranslation();
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
  // Shared write/clear engine — same optimistic save paths used by the
  // clipboard hook (cut / paste / Delete) and the cell editor.
  const { clearCell } = useSheetCellWrite();

  // Right-click → "Show edit history" opens a modal listing this cell's
  // AuditLog rows (user / timestamp / old → new). Lazy: the modal is only
  // mounted when opened, and FieldHistoryContent only fetches when `open`.
  const [historyOpen, setHistoryOpen] = useState(false);

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

  // Per-row cell typography (Phase 5d). The bold default lives OUTSIDE the
  // optional chain on purpose: every data cell renders bold unless an admin
  // explicitly sets 'normal' — including fallback rows with no SheetRowSetting
  // (style === null). Don't collapse this into `?? 'bold'` or un-configured
  // rows silently stop rendering bold.
  const cellTextStyle: React.CSSProperties = {
    fontWeight: rowSetting?.style?.font_weight === 'normal' ? 400 : 700,
  };
  if (rowSetting?.style?.font_style === 'italic') cellTextStyle.fontStyle = 'italic';
  const fontFamily = rowSetting?.style?.font_family
    ? SHEET_FONT_FAMILY[rowSetting.style.font_family]
    : undefined;
  if (fontFamily) cellTextStyle.fontFamily = fontFamily;
  // Per-row font size (px) is scaled by zoom so it tracks the rest of the cell
  // (which uses calc(11px * --sheet-zoom) in CSS). Unset = inherit the default.
  if (rowSetting?.style?.font_size) {
    cellTextStyle.fontSize = Math.round(rowSetting.style.font_size * sheetZoom);
  }
  if (cellAlign) {
    cellTextStyle.textAlign = cellAlign;
    cellTextStyle.display = 'block';
  }

  // Option list is shared across all cells (TanStack Query dedupes the fetch
  // and returns a referentially-stable array). Needed by getCellValue to
  // resolve harvest_status / documents_status codes → Turkmen labels, and by
  // getOptionColor below to paint per-option cell backgrounds.
  const { data: options } = useShipmentOptions();
  const value = getCellValue(shipment, rowConfig, options);
  // Per-value color (Google-Sheets-style conditional formatting on dropdown
  // values) takes precedence over the row-level admin color: a specific value
  // → specific color rule is more specific than "all cells in this row".
  // Covers both FK-driven dropdowns (country/customer/...) and the option-list
  // categories (harvest_status, documents_status, ...).
  const autoColor = getCellAutoColor(rowConfig.field_key, shipment, options);
  const cellBg = autoColor ?? rowSetting?.style?.color ?? undefined;
  // Admin-picked per-row cell text color wins over the auto WCAG-contrast color
  // chosen from the background — when no background is painted, font_color is
  // still applied so admins can recolor cell text on a plain row.
  const fontColorOverride = rowSetting?.style?.font_color ?? undefined;
  // Pair every painted background with a WCAG-contrast foreground so dark
  // picks don't hide the cell text. Inline `color` beats the various class-
  // based text colors (.sheet-cell__code, .sheet-cell--gapy .__text, etc.)
  // exactly like the inline `backgroundColor` already beats them.
  const cellBgStyle: React.CSSProperties = cellBg
    ? { backgroundColor: cellBg, color: fontColorOverride ?? getContrastTextColor(cellBg) }
    : (fontColorOverride ? { color: fontColorOverride } : {});
  const cellIsEmpty = isEmpty(value);

  const handleClick = useCallback(() => {
    // Empty editable cells → edit immediately on single click
    if (isEditable && !isHidden && cellIsEmpty) {
      setEditingCell({ shipmentId: shipment.id, rowKey: rowConfig.field_key });
      return;
    }
    setActiveCell({ shipmentId: shipment.id, rowKey: rowConfig.field_key });
  }, [isEditable, isHidden, cellIsEmpty, setActiveCell, setEditingCell, shipment.id, rowConfig.field_key]);

  const handleDoubleClick = useCallback(() => {
    // Filled editable cells → edit on double click
    if (isEditable && !isHidden && !cellIsEmpty) {
      setEditingCell({ shipmentId: shipment.id, rowKey: rowConfig.field_key });
    }
  }, [isEditable, isHidden, cellIsEmpty, setEditingCell, shipment.id, rowConfig.field_key]);

  // Right-click → context menu. Every cell gets the Dropdown wrapper so
  // future items (Copy value, View history, …) have a home; the **Clear cell**
  // item is disabled (greyed out) when clearing doesn't apply:
  //   • cell is not editable (read-only by role/lock)                — !isEditable
  //   • cell is hidden because shipment is gapy_satys + gapy_hidden  — isHidden
  //   • cargo_code (primary identifier, must never be null)
  //   • bool-backed dropdowns (peregruz, gornushi) — they're 0/1, not nullable;
  //     pick the "no" option from the dropdown instead.
  //   • read-only computed cells (has_doc_advance, has_sales_report) — these
  //     route handleClick to navigation, so even if isEditable were true the
  //     value can't be cleared from here.
  //   • cell is already empty — nothing to clear.
  // Per field-type clearing (custom → '', junction → [], else → null) and the
  // optimistic FK-companion wipe all live in useSheetCellWrite().clearCell.
  const canClear =
    isEditable && !isHidden && !cellIsEmpty && isClearableField(rowConfig);

  const handleClearCell = useCallback(() => {
    clearCell(shipment, rowConfig);
  }, [clearCell, shipment, rowConfig]);

  // Wrap every rendered cell with an antd Dropdown that opens on right-click.
  // We mount the wrapper unconditionally (not just for clearable cells) so we
  // have a single hook for future menu items (Copy, View history, etc.). With
  // ~880 cells in the DOM at peak (virtualized), each Dropdown is a thin
  // rc-trigger that only attaches an onContextMenu listener until opened.
  const wrap = (node: React.ReactElement): React.ReactElement => (
    <>
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: [
            {
              key: 'history',
              icon: <HistoryOutlined />,
              label: t('sheet.show_history'),
              onClick: () => setHistoryOpen(true),
            },
            { type: 'divider' },
            {
              key: 'clear',
              label: t('sheet.clear_cell'),
              danger: true,
              disabled: !canClear,
              onClick: canClear ? handleClearCell : undefined,
            },
          ],
        }}
      >
        {node}
      </Dropdown>
      {historyOpen && (
        <Modal
          open
          title={t('sheet.history_title')}
          footer={null}
          width={360}
          onCancel={() => setHistoryOpen(false)}
        >
          <FieldHistoryContent
            shipmentId={shipment.id}
            fieldKey={rowConfig.field_key}
            open={historyOpen}
          />
        </Modal>
      )}
    </>
  );

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
    return wrap(
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...cellBgStyle, ...(cellAlign ? { textAlign: cellAlign } : {}) }}
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
    return wrap(
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...cellBgStyle }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="sheet-cell__tags">
          {shipment.firm_splits.map((f) => (
            <Tag
              key={f.firm_code}
              // Per-firm admin color wins over the multi-firm purple fallback.
              // Antd Tag accepts hex strings directly via the `color` prop.
              color={f.firm_color ?? (shipment.firm_splits.length > 1 ? 'purple' : undefined)}
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
    return wrap(
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...cellBgStyle }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="sheet-cell__tags">
          {shipment.block_sources.map((b) => (
            <Tag
              key={b.block_code}
              // Per-block admin color wins; default "blue" preset otherwise.
              color={b.block_color ?? 'blue'}
              style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
            >
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
    return wrap(
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style} sheet-cell--linkable${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, cursor: 'pointer', ...cellBgStyle }}
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
    return wrap(
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...cellBgStyle }}
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
    return wrap(
      <div
        className={`sheet-cell sheet-cell--key${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: cellWidth, height: ROW_HEIGHT, ...cellBgStyle }}
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
  return wrap(
    <div
      className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isEditable ? ' sheet-cell--editable' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
      style={{ width: cellWidth, height: ROW_HEIGHT, position: 'relative', ...cellBgStyle }}
      title={value.length > 15 ? value : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <span className="sheet-cell__text" style={cellTextStyle}>{value}</span>
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
