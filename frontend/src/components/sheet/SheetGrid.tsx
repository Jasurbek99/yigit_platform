import { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type {
  IShipmentSheetItem,
  IRowConfig,
  ICurrentUser,
  ISheetCommentCounts,
  ISheetTaskCounts,
  ICommentTaskStatus,
  ISheetRowSettingForUser,
  ICellLastEdit,
} from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useAuth } from '@/hooks/useAuth';
import { canDo, canEditField } from '@/utils/permissions';
import { SheetCell } from './SheetCell';
import { SheetCellEditor } from './SheetCellEditor';
import { SheetLabelRow } from './SheetLabelColumn';
import {
  COL_WIDTH_SHIPMENT,
  COL_WIDTH_ROW_NUM,
  COL_WIDTH_WHO,
  COL_WIDTH_FIELD,
  FROZEN_LEFT_TOTAL,
  ROW_HEIGHT,
} from '@/constants/sheetRowConfig';

// Sheet field keys that map to junction-table resources rather than direct
// columns on Shipment. Editing these calls a dedicated action endpoint and
// permission is gated by the resource's edit flag, not field-level grants.
const JUNCTION_RESOURCE_BY_FIELD: Record<string, string> = {
  firm_splits: 'shipment_firm_split',
  block_sources: 'shipment_block_source',
};

function canEditCell(user: ICurrentUser | null, fieldKey: string): boolean {
  if (!user) return false;
  const junctionResource = JUNCTION_RESOURCE_BY_FIELD[fieldKey];
  if (junctionResource) {
    return canDo(user, junctionResource, 'edit');
  }
  return canEditField(user, 'shipment', fieldKey);
}

interface ISheetGridProps {
  shipments: IShipmentSheetItem[];
  rows: IRowConfig[];
  commentCounts?: ISheetCommentCounts;
  taskCounts?: ISheetTaskCounts;
  rowSettings?: Record<string, ISheetRowSettingForUser>;
  lastEdits?: Record<string, Record<string, ICellLastEdit>>;
  currentUserLang?: 'tk' | 'ru' | 'en';
  /**
   * Phase 2a: mapping from field_key → SheetRowSetting.id.
   * When provided, enables Up/Down reorder and hide controls on each row.
   * Obtained from useSheetRowIdMap() — omit (undefined) to disable controls.
   */
  fieldKeyToRowId?: Record<string, number>;
  /** Called with the new full ordered list of row IDs after a reorder. */
  onReorder?: (newRowOrder: number[]) => void;
  /** Called with the row ID to hide. */
  onHideRow?: (rowId: number) => void;
}

// z-index hierarchy
//   header row (sticky-top)              : 10
//   header sticky-left cells              : 12  (corner — must be above header virtualized headers)
//   frozen-rows section (sticky-top)      : 5
//   frozen-rows sticky-left cells         : 7
//   scrollable rows sticky-left cells     : 3
//   frozen data column wrapper (any row)  : 2  (above virtualized cells, below labels)
const Z_HEADER_CORNER = 12;
const Z_FROZEN_ROWS_LEFT = 7;
const Z_FROZEN_DATA_COL = 2;

export function SheetGrid({
  shipments,
  rows,
  commentCounts = {},
  taskCounts = {},
  rowSettings = {},
  lastEdits: _lastEdits = {},
  currentUserLang = 'tk',
  fieldKeyToRowId,
  onReorder,
  onHideRow,
}: ISheetGridProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { editingCell, frozenRowCount, frozenColCount } = useSheetStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Clamp freeze counts to the data we actually have so an old localStorage
  // value (e.g. 5 frozen cols, but the user now sees only 2 shipments) still
  // produces a coherent layout.
  const safeFrozenRowCount = Math.min(frozenRowCount, rows.length);
  const safeFrozenColCount = Math.min(frozenColCount, shipments.length);

  const frozenRows = useMemo(
    () => rows.slice(0, safeFrozenRowCount),
    [rows, safeFrozenRowCount],
  );
  const scrollableRows = useMemo(
    () => rows.slice(safeFrozenRowCount),
    [rows, safeFrozenRowCount],
  );

  const frozenShipments = useMemo(
    () => shipments.slice(0, safeFrozenColCount),
    [shipments, safeFrozenColCount],
  );
  const scrollableShipments = useMemo(
    () => shipments.slice(safeFrozenColCount),
    [shipments, safeFrozenColCount],
  );

  const columnVirtualizer = useVirtualizer({
    count: scrollableShipments.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => COL_WIDTH_SHIPMENT,
    horizontal: true,
    overscan: 5,
  });

  // ─── Reorder helpers ───────────────────────────────────────────────────────
  // Compute the new ordered list of row IDs after moving row at `fromIndex`
  // to `fromIndex + direction` (direction: -1 = up, +1 = down).
  // Only rows with known IDs (in fieldKeyToRowId) participate in user ordering.
  const handleMove = useCallback(
    (fromIndex: number, direction: -1 | 1) => {
      if (!fieldKeyToRowId || !onReorder) return;

      const toIndex = fromIndex + direction;
      if (toIndex < 0 || toIndex >= rows.length) return;

      // Build an ordered ID list. Rows without an ID are filtered out —
      // they cannot be referenced in the PATCH payload.
      const idsInCurrentOrder = rows
        .map((r) => fieldKeyToRowId[r.field_key])
        .filter((id): id is number => id !== undefined);

      // Resolve the source/target by field_key → id, then locate them inside
      // idsInCurrentOrder. Using global indices into `rows` would mis-target
      // when any preceding row lacks an id (idsInCurrentOrder is shorter).
      const fromId = fieldKeyToRowId[rows[fromIndex]?.field_key];
      const toId = fieldKeyToRowId[rows[toIndex]?.field_key];
      if (fromId === undefined || toId === undefined) return;

      const swapped = [...idsInCurrentOrder];
      const fromSlot = swapped.indexOf(fromId);
      const toSlot = swapped.indexOf(toId);
      if (fromSlot === -1 || toSlot === -1) return;
      swapped[fromSlot] = toId;
      swapped[toSlot] = fromId;

      onReorder(swapped);
    },
    [fieldKeyToRowId, onReorder, rows],
  );

  const handleHideRow = useCallback(
    (rowConfig: IRowConfig) => {
      if (!fieldKeyToRowId || !onHideRow) return;
      const rowId = fieldKeyToRowId[rowConfig.field_key];
      if (rowId === undefined) return;
      onHideRow(rowId);
    },
    [fieldKeyToRowId, onHideRow],
  );

  const renderRow = useCallback(
    (rowConfig: IRowConfig, shipment: IShipmentSheetItem) => {
      const isEditing =
        editingCell?.shipmentId === shipment.id &&
        editingCell?.rowKey === rowConfig.field_key;

      // Trust the backend-computed decision (row_settings[fk].can_current_user_edit)
      // when present — it already composes RoleFieldPermission with the v2 row
      // triggers (is_locked, triggered_roles, triggered_user, extra_users). The
      // legacy local canEditCell only knows about RoleFieldPermission and would
      // disable cells the user can edit via a v2-only grant. Fallback to the
      // legacy check only when the row has no row_settings entry (e.g., a field
      // not in DEFAULT_SHEET_ROWS).
      const v2EditDecision = rowSettings[rowConfig.field_key]?.can_current_user_edit;
      const isEditable =
        rowConfig.input_type !== 'readonly' &&
        (v2EditDecision ?? canEditCell(user, rowConfig.field_key));

      // Comment / task badge for this specific cell
      const cellCounts = commentCounts[shipment.id] ?? {};
      const cellCommentCount = cellCounts[rowConfig.field_key] ?? 0;
      const shipmentTaskCounts = taskCounts[shipment.id];
      const cellTaskState: ICommentTaskStatus | null =
        cellCommentCount > 0 && shipmentTaskCounts
          ? shipmentTaskCounts.open > 0
            ? 'open'
            : 'done'
          : null;

      if (isEditing) {
        return (
          <SheetCellEditor
            key={`${shipment.id}-${rowConfig.row_number}`}
            shipment={shipment}
            rowConfig={rowConfig}
          />
        );
      }

      return (
        <SheetCell
          key={`${shipment.id}-${rowConfig.row_number}`}
          shipment={shipment}
          rowConfig={rowConfig}
          isEditable={isEditable}
          commentCount={cellCommentCount}
          commentTaskState={cellTaskState}
          rowSetting={rowSettings[rowConfig.field_key]}
        />
      );
    },
    [editingCell, user, commentCounts, taskCounts, rowSettings],
  );

  const virtualColumns = columnVirtualizer.getVirtualItems();

  // Frozen data column headers (sticky-left)
  const frozenColumnHeaders = useMemo(
    () =>
      frozenShipments.map((shipment, idx) => {
        const codeShort = shipment.cargo_code.slice(0, 7);
        const isLast = idx === frozenShipments.length - 1;
        return (
          <div
            key={shipment.id}
            className={`sheet-col-header sheet-col-header--frozen${isLast ? ' sheet-col-header--last' : ''}`}
            style={{
              position: 'sticky',
              left: FROZEN_LEFT_TOTAL + idx * COL_WIDTH_SHIPMENT,
              width: COL_WIDTH_SHIPMENT,
              height: ROW_HEIGHT,
              zIndex: Z_HEADER_CORNER,
              flexShrink: 0,
            }}
          >
            <span className="sheet-col-header__seq">{idx + 1}</span>
            <span className="sheet-col-header__code">{codeShort}</span>
          </div>
        );
      }),
    [frozenShipments],
  );

  // Virtualized (scrollable) column headers — seq number continues from frozen count
  const virtualColumnHeaders = useMemo(
    () =>
      virtualColumns.map((vc) => {
        const shipment = scrollableShipments[vc.index];
        const codeShort = shipment.cargo_code.slice(0, 7);
        return (
          <div
            key={shipment.id}
            className="sheet-col-header"
            style={{
              position: 'absolute',
              left: vc.start,
              width: COL_WIDTH_SHIPMENT,
              height: ROW_HEIGHT,
            }}
          >
            <span className="sheet-col-header__seq">{vc.index + 1 + safeFrozenColCount}</span>
            <span className="sheet-col-header__code">{codeShort}</span>
          </div>
        );
      }),
    [virtualColumns, scrollableShipments, safeFrozenColCount],
  );

  const renderSection = (sectionRows: IRowConfig[], inFrozenSection: boolean) =>
    sectionRows.map((rowConfig, sectionIndex) => {
      const stickyLeftZ = inFrozenSection ? Z_FROZEN_ROWS_LEFT : 3;

      // Global index within the full rows array (needed for canMoveUp/canMoveDown)
      const globalIndex = inFrozenSection
        ? sectionIndex
        : safeFrozenRowCount + sectionIndex;

      // Reorder controls — only available when callbacks are provided
      const hasReorderCapability = fieldKeyToRowId !== undefined && onReorder !== undefined;
      const rowHasId = hasReorderCapability && fieldKeyToRowId[rowConfig.field_key] !== undefined;

      const canMoveUp = rowHasId && globalIndex > 0;
      const canMoveDown = rowHasId && globalIndex < rows.length - 1;

      return (
        <div
          key={rowConfig.row_number}
          className="sheet-row"
          style={{ display: 'flex', height: ROW_HEIGHT }}
        >
          {/* Frozen left labels (#, who, field name) — already sticky-left */}
          <SheetLabelRow
            rowConfig={rowConfig}
            stickyZIndex={stickyLeftZ}
            rowSettings={rowSettings}
            currentUserLang={currentUserLang}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveUp={
              hasReorderCapability && rowHasId
                ? () => handleMove(globalIndex, -1)
                : undefined
            }
            onMoveDown={
              hasReorderCapability && rowHasId
                ? () => handleMove(globalIndex, 1)
                : undefined
            }
            onHideRow={
              fieldKeyToRowId !== undefined && onHideRow !== undefined && rowHasId
                ? () => handleHideRow(rowConfig)
                : undefined
            }
          />

          {/* Frozen data columns (sticky-left, between label band and virtualizer) */}
          {frozenShipments.map((shipment, idx) => {
            const isLast = idx === frozenShipments.length - 1;
            return (
              <div
                key={shipment.id}
                className={`sheet-frozen-col-wrap${isLast ? ' sheet-frozen-col-wrap--last' : ''}`}
                style={{
                  position: 'sticky',
                  left: FROZEN_LEFT_TOTAL + idx * COL_WIDTH_SHIPMENT,
                  width: COL_WIDTH_SHIPMENT,
                  height: ROW_HEIGHT,
                  zIndex: Z_FROZEN_DATA_COL,
                  flexShrink: 0,
                }}
              >
                {renderRow(rowConfig, shipment)}
              </div>
            );
          })}

          {/* Virtualized scrollable data columns */}
          <div
            style={{
              position: 'relative',
              width: columnVirtualizer.getTotalSize(),
              height: ROW_HEIGHT,
            }}
          >
            {virtualColumns.map((vc) => {
              const shipment = scrollableShipments[vc.index];
              return (
                <div
                  key={shipment.id}
                  style={{
                    position: 'absolute',
                    left: vc.start,
                    width: COL_WIDTH_SHIPMENT,
                    height: ROW_HEIGHT,
                  }}
                >
                  {renderRow(rowConfig, shipment)}
                </div>
              );
            })}
          </div>
        </div>
      );
    });

  return (
    <div className="sheet-grid" ref={scrollContainerRef}>
      {/* Header row — sticky-top */}
      <div
        className="sheet-header-row"
        style={{ display: 'flex', height: ROW_HEIGHT, position: 'sticky', top: 0, zIndex: 10 }}
      >
        {/* Frozen-left header label cells */}
        <div
          style={{
            width: COL_WIDTH_ROW_NUM,
            position: 'sticky',
            left: 0,
            zIndex: Z_HEADER_CORNER,
            flexShrink: 0,
          }}
          className="sheet-label-col sheet-label-col--num"
        >
          #
        </div>
        <div
          style={{
            width: COL_WIDTH_WHO,
            position: 'sticky',
            left: COL_WIDTH_ROW_NUM,
            zIndex: Z_HEADER_CORNER,
            flexShrink: 0,
          }}
          className="sheet-label-col sheet-label-col--who"
        >
          {t('sheet.who.none')}
        </div>
        <div
          style={{
            width: COL_WIDTH_FIELD,
            position: 'sticky',
            left: COL_WIDTH_ROW_NUM + COL_WIDTH_WHO,
            zIndex: Z_HEADER_CORNER,
            flexShrink: 0,
          }}
          className="sheet-label-col sheet-label-col--field"
        >
          {t('sheet.row.shipment_code')}
        </div>

        {/* Frozen data column headers (sticky-left) */}
        {frozenColumnHeaders}

        {/* Virtualized column headers */}
        <div
          style={{
            position: 'relative',
            width: columnVirtualizer.getTotalSize(),
            height: ROW_HEIGHT,
          }}
        >
          {virtualColumnHeaders}
        </div>
      </div>

      {/* Frozen rows section — sticky-top below header */}
      {frozenRows.length > 0 && (
        <div
          className="sheet-frozen-top"
          style={{ position: 'sticky', top: ROW_HEIGHT, zIndex: 5 }}
        >
          {renderSection(frozenRows, true)}
        </div>
      )}

      {/* Scrollable rows section */}
      <div className="sheet-scrollable-bottom">{renderSection(scrollableRows, false)}</div>
    </div>
  );
}
