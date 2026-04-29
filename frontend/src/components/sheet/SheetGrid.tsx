import { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem, IRowConfig, ICurrentUser, ISheetCommentCounts, ISheetTaskCounts, ICommentTaskStatus } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useAuth } from '@/hooks/useAuth';
import { canDo, canEditField } from '@/utils/permissions';
import { SheetCell } from './SheetCell';
import { SheetCellEditor } from './SheetCellEditor';
import { SheetLabelRow } from './SheetLabelColumn';
import {
  SHEET_ROW_CONFIG,
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
  commentCounts?: ISheetCommentCounts;
  taskCounts?: ISheetTaskCounts;
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

export function SheetGrid({ shipments, commentCounts = {}, taskCounts = {} }: ISheetGridProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { editingCell, frozenRowCount, frozenColCount } = useSheetStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Clamp freeze counts to the data we actually have so an old localStorage
  // value (e.g. 5 frozen cols, but the user now sees only 2 shipments) still
  // produces a coherent layout.
  const safeFrozenRowCount = Math.min(frozenRowCount, SHEET_ROW_CONFIG.length);
  const safeFrozenColCount = Math.min(frozenColCount, shipments.length);

  const frozenRows = useMemo(
    () => SHEET_ROW_CONFIG.slice(0, safeFrozenRowCount),
    [safeFrozenRowCount],
  );
  const scrollableRows = useMemo(
    () => SHEET_ROW_CONFIG.slice(safeFrozenRowCount),
    [safeFrozenRowCount],
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

  const renderRow = useCallback(
    (rowConfig: IRowConfig, shipment: IShipmentSheetItem) => {
      const isEditing =
        editingCell?.shipmentId === shipment.id &&
        editingCell?.rowKey === rowConfig.fieldKey;

      const isEditable =
        rowConfig.inputType !== 'readonly' &&
        canEditCell(user, rowConfig.fieldKey);

      // Comment / task badge for this specific cell
      const cellCounts = commentCounts[shipment.id] ?? {};
      const cellCommentCount = cellCounts[rowConfig.fieldKey] ?? 0;
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
            key={`${shipment.id}-${rowConfig.rowNumber}`}
            shipment={shipment}
            rowConfig={rowConfig}
          />
        );
      }

      return (
        <SheetCell
          key={`${shipment.id}-${rowConfig.rowNumber}`}
          shipment={shipment}
          rowConfig={rowConfig}
          isEditable={isEditable}
          commentCount={cellCommentCount}
          commentTaskState={cellTaskState}
        />
      );
    },
    [editingCell, user, commentCounts, taskCounts],
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

  const renderSection = (rows: IRowConfig[], inFrozenSection: boolean) =>
    rows.map((rowConfig) => {
      const stickyLeftZ = inFrozenSection ? Z_FROZEN_ROWS_LEFT : 3;
      return (
        <div
          key={rowConfig.rowNumber}
          className="sheet-row"
          style={{ display: 'flex', height: ROW_HEIGHT }}
        >
          {/* Frozen left labels (#, who, field name) — already sticky-left */}
          <SheetLabelRow rowConfig={rowConfig} stickyZIndex={stickyLeftZ} />

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
