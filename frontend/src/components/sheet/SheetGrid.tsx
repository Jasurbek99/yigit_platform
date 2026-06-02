import { useRef, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { useSaveSheetColumnOrder } from '@/hooks/useShipmentSheet';
import { SheetCell } from './SheetCell';
import { SheetCellEditor } from './SheetCellEditor';
import { SheetLabelRow } from './SheetLabelColumn';
import { SheetColumnHeader } from './SheetColumnHeader';
import { scaleSheetLayout } from '@/constants/sheetRowConfig';

// ─── Sortable column header wrapper ──────────────────────────────────────────
// Each shipment column header becomes a useSortable item while reorderMode is on.
// The wrapper handles the DnD listeners and transform CSS; the inner
// SheetColumnHeader stays unchanged and the color picker is hidden during reorder
// so the whole header surface is safely draggable.

interface ISortableHeaderWrapperProps {
  shipmentId: number;
  children: React.ReactNode;
  /** Extra class names forwarded from the outer header container. */
  className: string;
  style: React.CSSProperties;
  onClick?: () => void;
}

function SortableHeaderWrapper({
  shipmentId,
  children,
  className,
  style,
  onClick,
}: ISortableHeaderWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shipmentId });

  const combinedStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    userSelect: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      className={`${className} sheet-col-header--sortable`}
      style={combinedStyle}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

// Sheet field keys that map to junction-table resources rather than direct
// columns on Shipment. Editing these calls a dedicated action endpoint and
// permission is gated by the resource's edit flag, not field-level grants.
const JUNCTION_RESOURCE_BY_FIELD: Record<string, string> = {
  firm_splits: 'shipment_firm_split',
  block_sources: 'shipment_block_source',
};

// Roles whose columns get a supply-side green tint in the Sheet.
const SUPPLY_ROLES = new Set(['loading_dept_head', 'warehouse_chief']);

function isSupplyColumn(shipment: IShipmentSheetItem): boolean {
  return SUPPLY_ROLES.has(shipment.created_by_role ?? '');
}

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
  // Granular selectors — a bare useSheetStore() re-renders the whole grid on
  // every unrelated store change (activeCell on each cell click, searchText on
  // each keystroke, comments drawer toggles). Subscribe only to what the grid
  // layout actually depends on.
  const editingCell = useSheetStore((s) => s.editingCell);
  const frozenRowCount = useSheetStore((s) => s.frozenRowCount);
  const frozenColCount = useSheetStore((s) => s.frozenColCount);
  const sheetZoom = useSheetStore((s) => s.sheetZoom);
  const joinMode = useSheetStore((s) => s.joinMode);
  const joinSelection = useSheetStore((s) => s.joinSelection);
  const toggleJoinSelection = useSheetStore((s) => s.toggleJoinSelection);
  const swapMode = useSheetStore((s) => s.swapMode);
  const swapSelection = useSheetStore((s) => s.swapSelection);
  const toggleSwapSelection = useSheetStore((s) => s.toggleSwapSelection);
  const reorderMode = useSheetStore((s) => s.reorderMode);
  const setColumnOrder = useSheetStore((s) => s.setColumnOrder);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ─── Column reorder: dnd-kit setup ──────────────────────────────────────
  // Use PointerSensor with a 5px activation distance so that a simple click
  // (e.g. color picker in normal mode) doesn't accidentally start a drag.
  // While reorderMode is on, the color picker is hidden (SheetColumnHeader
  // receives reorderMode prop), so dragging the full header surface is safe.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const saveColumnOrder = useSaveSheetColumnOrder();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = shipments.findIndex((s) => s.id === active.id);
      const newIndex = shipments.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(shipments, oldIndex, newIndex);
      const orderedIds = reordered.map((s) => s.id);

      // Apply optimistically — ShipmentSheet derives `filtered` from columnOrder
      setColumnOrder(orderedIds);
      // Persist to server — backend stores per-shipment sheet_position
      saveColumnOrder.mutate({ shipment_ids: orderedIds });
    },
    [shipments, setColumnOrder, saveColumnOrder],
  );

  // Scaled layout px — every cell width/height + the virtualizer's estimateSize
  // derive from the same zoom so the rendered grid and the virtualizer agree.
  const {
    colRowNum: COL_WIDTH_ROW_NUM,
    colWho: COL_WIDTH_WHO,
    colField: COL_WIDTH_FIELD,
    colShipment: COL_WIDTH_SHIPMENT,
    frozenLeftTotal: FROZEN_LEFT_TOTAL,
    rowHeight: ROW_HEIGHT,
  } = scaleSheetLayout(sheetZoom);

  // Clamp freeze counts to the data we actually have so an old localStorage
  // value (e.g. 5 frozen cols, but the user now sees only 2 shipments) still
  // produces a coherent layout.
  const safeFrozenRowCount = Math.min(frozenRowCount, rows.length);
  // frozenColCount counts ALL frozen columns: Row #, Who, Field name, then
  // shipments. So 3 = full label band frozen (default); 4+ = label band +
  // (N-3) shipments. Cap at 3 + shipments.length so we never ask for more
  // shipment columns than exist.
  const TOTAL_LABEL_COLS = 3;
  const safeFrozenColCount = Math.min(
    frozenColCount,
    TOTAL_LABEL_COLS + shipments.length,
  );
  const labelStickyCount = Math.min(safeFrozenColCount, TOTAL_LABEL_COLS) as 0 | 1 | 2 | 3;
  // While reorderMode is on, treat shipment freeze count as 0 so all shipment
  // columns live in the single virtualized+sortable track and drag uniformly.
  // The label band (Row #, Who, Field) keeps its freeze setting unchanged.
  const shipmentFreezeCount = reorderMode
    ? 0
    : Math.max(0, safeFrozenColCount - TOTAL_LABEL_COLS);

  const frozenRows = useMemo(
    () => rows.slice(0, safeFrozenRowCount),
    [rows, safeFrozenRowCount],
  );
  const scrollableRows = useMemo(
    () => rows.slice(safeFrozenRowCount),
    [rows, safeFrozenRowCount],
  );

  const frozenShipments = useMemo(
    () => shipments.slice(0, shipmentFreezeCount),
    [shipments, shipmentFreezeCount],
  );
  const scrollableShipments = useMemo(
    () => shipments.slice(shipmentFreezeCount),
    [shipments, shipmentFreezeCount],
  );

  const columnVirtualizer = useVirtualizer({
    count: scrollableShipments.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => COL_WIDTH_SHIPMENT,
    horizontal: true,
    // Pre-mount more off-screen columns so a scroll sweep crosses the
    // mount-boundary less often (fewer cell-mount bursts mid-scroll). Tunable:
    // higher = smoother scroll but more DOM + a heavier per-tick rebuild;
    // lower = lighter rebuild but more frequent mount bursts.
    overscan: 8,
  });

  // Zoom changes the per-column estimate; force the virtualizer to discard its
  // cached item sizes so positions recompute against the new scaled width.
  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, COL_WIDTH_SHIPMENT]);

  // ─── Arrow-key navigation ─────────────────────────────────────────────────
  // Arrows move activeCell across the grid; Enter opens the editor on the
  // current cell (if not readonly). The listener reads volatile flags
  // (editingCell, modes, activeCell) via getState() so we don't have to
  // re-bind the listener on every store change — only structural inputs
  // (rows / shipments / dimensions) drive the effect deps.
  useEffect(() => {
    const NAV_KEYS = new Set([
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Enter',
    ]);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!NAV_KEYS.has(e.key)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      // Don't intercept keystrokes targeted at form controls or
      // contenteditable surfaces (cell editor inputs, comments composer,
      // search box, etc.).
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const state = useSheetStore.getState();
      if (state.editingCell) return;
      if (state.reorderMode || state.joinMode || state.swapMode) return;

      const active = state.activeCell;
      if (!active) return;

      const rowIdx = rows.findIndex((r) => r.field_key === active.rowKey);
      const shipmentIdx = shipments.findIndex((s) => s.id === active.shipmentId);
      if (rowIdx === -1 || shipmentIdx === -1) return;

      if (e.key === 'Enter') {
        const rowConfig = rows[rowIdx];
        if (rowConfig?.input_type !== 'readonly') {
          state.setEditingCell({
            shipmentId: active.shipmentId,
            rowKey: active.rowKey,
          });
          e.preventDefault();
        }
        return;
      }

      const stepRow =
        e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      const stepCol =
        e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (stepRow === 0 && stepCol === 0) return;

      // Walk in the chosen direction until we land on a non-gapy-hidden cell
      // or step out of the grid. The safety counter caps the search at the
      // worst-case linear sweep across one axis.
      let newRow = rowIdx;
      let newCol = shipmentIdx;
      const maxSteps = Math.max(rows.length, shipments.length) + 1;
      let found = false;
      for (let i = 0; i < maxSteps; i++) {
        newRow += stepRow;
        newCol += stepCol;
        if (newRow < 0 || newRow >= rows.length) break;
        if (newCol < 0 || newCol >= shipments.length) break;
        const gapyHidden =
          rows[newRow].gapy_hidden && shipments[newCol].is_gapy_satys;
        if (!gapyHidden) {
          found = true;
          break;
        }
      }
      if (!found) return;

      state.setActiveCell({
        shipmentId: shipments[newCol].id,
        rowKey: rows[newRow].field_key,
      });
      e.preventDefault();

      // Horizontal: bring the new column into view via the virtualizer when
      // it lives in the scrollable (non-frozen) shipment band.
      if (newCol >= shipmentFreezeCount) {
        columnVirtualizer.scrollToIndex(newCol - shipmentFreezeCount, {
          align: 'auto',
        });
      }

      // Vertical: only the scrollable rows section can be off-screen — frozen
      // rows are sticky-top and always visible. Flow Y of row at globalIdx is
      // (1 + globalIdx) * ROW_HEIGHT (header + every row above it). The sticky
      // band covers (1 + frozenRowCount) * ROW_HEIGHT at the top of the
      // viewport, so the first non-occluded pixel is scrollTop + stickyBand.
      const container = scrollContainerRef.current;
      if (container && newRow >= safeFrozenRowCount) {
        const stickyBand = (1 + safeFrozenRowCount) * ROW_HEIGHT;
        const rowTop = (1 + newRow) * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        const viewTop = container.scrollTop + stickyBand;
        const viewBottom = container.scrollTop + container.clientHeight;
        if (rowTop < viewTop) {
          container.scrollTop = rowTop - stickyBand;
        } else if (rowBottom > viewBottom) {
          container.scrollTop = rowBottom - container.clientHeight;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    rows,
    shipments,
    shipmentFreezeCount,
    safeFrozenRowCount,
    ROW_HEIGHT,
    columnVirtualizer,
  ]);

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

  // Drag-reorder: move row at fromIndex to position toIndex (splice-and-insert,
  // unlike handleMove which swaps adjacent rows for the Up/Down arrows).
  // Drag drops can land far from the source.
  const handleReorderTo = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!fieldKeyToRowId || !onReorder) return;
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= rows.length || toIndex >= rows.length) return;

      const idsInCurrentOrder = rows
        .map((r) => fieldKeyToRowId[r.field_key])
        .filter((id): id is number => id !== undefined);

      const fromId = fieldKeyToRowId[rows[fromIndex]?.field_key];
      const toId = fieldKeyToRowId[rows[toIndex]?.field_key];
      if (fromId === undefined || toId === undefined) return;

      const fromSlot = idsInCurrentOrder.indexOf(fromId);
      const toSlot = idsInCurrentOrder.indexOf(toId);
      if (fromSlot === -1 || toSlot === -1) return;

      const updated = [...idsInCurrentOrder];
      updated.splice(fromSlot, 1);
      // Forward drag (fromSlot < toSlot): removing the source shifts every
      // index past it down by 1, so insert at toSlot - 1 to land *above* the
      // visual drop indicator. Backward drag (fromSlot > toSlot): the target
      // index is unaffected by the removal. Equal slots short-circuited above.
      const adjustedTo = fromSlot < toSlot ? toSlot - 1 : toSlot;
      updated.splice(adjustedTo, 0, fromId);
      onReorder(updated);
    },
    [fieldKeyToRowId, onReorder, rows],
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
  // When reorderMode is on, shipmentFreezeCount is 0, so frozenShipments is
  // always empty and this memo produces an empty array. Kept for non-reorder mode.
  const frozenColumnHeaders = useMemo(
    () =>
      frozenShipments.map((shipment, idx) => {
        const isLast = idx === frozenShipments.length - 1;
        const cancelled = shipment.status_code === 'cancelled';
        const supply = isSupplyColumn(shipment) && !shipment.column_color;
        const isDraft = shipment.status_code === 'draft';
        const isJoinSelected = joinSelection.includes(shipment.id);
        const joinSelectable = joinMode && isDraft;
        const swapSelectable = swapMode;
        const isSwapSelected = swapSelection.includes(shipment.id);
        return (
          <div
            key={shipment.id}
            className={[
              'sheet-col-header',
              'sheet-col-header--frozen',
              isLast ? 'sheet-col-header--last' : '',
              cancelled ? 'sheet-col-header--cancelled' : '',
              supply ? 'sheet-col-supply-tint' : '',
              joinSelectable ? 'sheet-col-header--join-selectable' : '',
              isJoinSelected ? 'sheet-col-header--join-selected' : '',
              swapSelectable ? 'sheet-col-header--swap-selectable' : '',
              isSwapSelected ? 'sheet-col-header--swap-selected' : '',
            ].filter(Boolean).join(' ')}
            style={{
              position: 'sticky',
              left: FROZEN_LEFT_TOTAL + idx * COL_WIDTH_SHIPMENT,
              width: COL_WIDTH_SHIPMENT,
              height: ROW_HEIGHT,
              zIndex: Z_HEADER_CORNER,
              flexShrink: 0,
              ...(shipment.column_color
                ? { borderTop: `3px solid ${shipment.column_color}` }
                : supply
                ? { borderTop: '3px solid #16a34a' }
                : null),
            }}
            onClick={
              swapMode
                ? () => toggleSwapSelection(shipment.id)
                : joinMode && isDraft
                ? () => toggleJoinSelection(shipment.id)
                : undefined
            }
          >
            <SheetColumnHeader
              shipmentId={shipment.id}
              seqNumber={idx + 1}
              exportCode={shipment.cargo_code}
              columnColor={shipment.column_color}
              isCancelled={cancelled}
              hideColorPicker={reorderMode}
            />
          </div>
        );
      }),
    [frozenShipments, COL_WIDTH_SHIPMENT, FROZEN_LEFT_TOTAL, ROW_HEIGHT, joinMode, joinSelection, toggleJoinSelection, swapMode, swapSelection, toggleSwapSelection, reorderMode],
  );

  // Virtualized (scrollable) column headers — seq number continues from frozen count.
  // When reorderMode is on, these become SortableHeaderWrapper items.
  const virtualColumnHeaders = useMemo(
    () =>
      virtualColumns.map((vc) => {
        const shipment = scrollableShipments[vc.index];
        const cancelled = shipment.status_code === 'cancelled';
        const supply = isSupplyColumn(shipment) && !shipment.column_color;
        const isDraft = shipment.status_code === 'draft';
        const isJoinSelected = joinSelection.includes(shipment.id);
        const joinSelectable = joinMode && isDraft;
        const swapSelectable = swapMode;
        const isSwapSelected = swapSelection.includes(shipment.id);

        const headerClassName = [
          'sheet-col-header',
          cancelled ? 'sheet-col-header--cancelled' : '',
          supply ? 'sheet-col-supply-tint' : '',
          joinSelectable ? 'sheet-col-header--join-selectable' : '',
          isJoinSelected ? 'sheet-col-header--join-selected' : '',
          swapSelectable ? 'sheet-col-header--swap-selectable' : '',
          isSwapSelected ? 'sheet-col-header--swap-selected' : '',
        ].filter(Boolean).join(' ');

        const headerStyle: React.CSSProperties = {
          position: 'absolute',
          left: vc.start,
          width: COL_WIDTH_SHIPMENT,
          height: ROW_HEIGHT,
          ...(shipment.column_color
            ? { borderTop: `3px solid ${shipment.column_color}` }
            : supply
            ? { borderTop: '3px solid #16a34a' }
            : null),
        };

        const headerContent = (
          <SheetColumnHeader
            shipmentId={shipment.id}
            seqNumber={vc.index + 1 + shipmentFreezeCount}
            exportCode={shipment.cargo_code}
            columnColor={shipment.column_color}
            isCancelled={cancelled}
            hideColorPicker={reorderMode}
          />
        );

        const handleJoinClick = swapMode
          ? () => toggleSwapSelection(shipment.id)
          : joinMode && isDraft
          ? () => toggleJoinSelection(shipment.id)
          : undefined;

        if (reorderMode) {
          // In reorder mode: wrap in SortableHeaderWrapper for dnd-kit drag support.
          // The absolute position (left: vc.start) is applied as a base — the
          // SortableHeaderWrapper adds a CSS transform on top of it during drag.
          return (
            <SortableHeaderWrapper
              key={shipment.id}
              shipmentId={shipment.id}
              className={headerClassName}
              style={headerStyle}
              onClick={handleJoinClick}
            >
              {headerContent}
            </SortableHeaderWrapper>
          );
        }

        return (
          <div
            key={shipment.id}
            className={headerClassName}
            style={headerStyle}
            onClick={handleJoinClick}
          >
            {headerContent}
          </div>
        );
      }),
    [virtualColumns, scrollableShipments, shipmentFreezeCount, COL_WIDTH_SHIPMENT, ROW_HEIGHT, joinMode, joinSelection, toggleJoinSelection, swapMode, swapSelection, toggleSwapSelection, reorderMode],
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
          {/* Frozen left labels (#, who, field name) — sticky cells per user's
              labelStickyCount (0–3). */}
          <SheetLabelRow
            rowConfig={rowConfig}
            stickyZIndex={stickyLeftZ}
            labelStickyCount={labelStickyCount}
            rowSettings={rowSettings}
            currentUserLang={currentUserLang}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            rowIndex={globalIndex}
            onReorderTo={
              // Disable row reorder while column reorder mode is active
              // so the two DnD systems don't conflict.
              !reorderMode && hasReorderCapability && rowHasId
                ? handleReorderTo
                : undefined
            }
            onMoveUp={
              !reorderMode && hasReorderCapability && rowHasId
                ? () => handleMove(globalIndex, -1)
                : undefined
            }
            onMoveDown={
              !reorderMode && hasReorderCapability && rowHasId
                ? () => handleMove(globalIndex, 1)
                : undefined
            }
            onHideRow={
              !reorderMode && fieldKeyToRowId !== undefined && onHideRow !== undefined && rowHasId
                ? () => handleHideRow(rowConfig)
                : undefined
            }
          />

          {/* Frozen data columns (sticky-left, between label band and virtualizer) */}
          {frozenShipments.map((shipment, idx) => {
            const isLast = idx === frozenShipments.length - 1;
            const tinted = shipment.column_color ? ' sheet-col-tinted' : '';
            const supply = isSupplyColumn(shipment) && !shipment.column_color ? ' sheet-col-supply-tint' : '';
            const cancelled = shipment.status_code === 'cancelled' ? ' sheet-col--cancelled' : '';
            return (
              <div
                key={shipment.id}
                className={`sheet-frozen-col-wrap${isLast ? ' sheet-frozen-col-wrap--last' : ''}${tinted}${supply}${cancelled}`}
                style={{
                  position: 'sticky',
                  left: FROZEN_LEFT_TOTAL + idx * COL_WIDTH_SHIPMENT,
                  width: COL_WIDTH_SHIPMENT,
                  height: ROW_HEIGHT,
                  zIndex: Z_FROZEN_DATA_COL,
                  flexShrink: 0,
                  ...(shipment.column_color
                    ? ({ ['--col-tint' as string]: shipment.column_color } as React.CSSProperties)
                    : null),
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
              const tinted = shipment.column_color ? ' sheet-col-tinted' : '';
              const supply = isSupplyColumn(shipment) && !shipment.column_color ? ' sheet-col-supply-tint' : '';
              const cancelled = shipment.status_code === 'cancelled' ? ' sheet-col--cancelled' : '';
              return (
                <div
                  key={shipment.id}
                  className={`sheet-virt-col-wrap${tinted}${supply}${cancelled}`}
                  style={{
                    position: 'absolute',
                    left: vc.start,
                    width: COL_WIDTH_SHIPMENT,
                    height: ROW_HEIGHT,
                    ...(shipment.column_color
                      ? ({ ['--col-tint' as string]: shipment.column_color } as React.CSSProperties)
                      : null),
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

  // SortableContext items must include ALL shipment IDs (not just visible ones)
  // so dnd-kit knows the full order even when many columns are off-screen.
  const sortableIds = useMemo(
    () => shipments.map((s) => s.id),
    [shipments],
  );

  // Inner header row content — extracted so it can be wrapped conditionally
  // in DndContext without duplicating the label-band JSX.
  const headerLabelBand = (
    <>
      <div
        style={{
          width: COL_WIDTH_ROW_NUM,
          ...(labelStickyCount >= 1
            ? { position: 'sticky' as const, left: 0, zIndex: Z_HEADER_CORNER }
            : null),
          flexShrink: 0,
        }}
        className="sheet-label-col sheet-label-col--num"
      >
        #
      </div>
      <div
        style={{
          width: COL_WIDTH_WHO,
          ...(labelStickyCount >= 2
            ? {
                position: 'sticky' as const,
                left: COL_WIDTH_ROW_NUM,
                zIndex: Z_HEADER_CORNER,
              }
            : null),
          flexShrink: 0,
        }}
        className="sheet-label-col sheet-label-col--who"
      >
        {t('sheet.who.none')}
      </div>
      <div
        style={{
          width: COL_WIDTH_FIELD,
          ...(labelStickyCount >= 3
            ? {
                position: 'sticky' as const,
                left: COL_WIDTH_ROW_NUM + COL_WIDTH_WHO,
                zIndex: Z_HEADER_CORNER,
              }
            : null),
          flexShrink: 0,
        }}
        className="sheet-label-col sheet-label-col--field"
      >
        {t('sheet.row.shipment_code')}
      </div>
    </>
  );

  const headerColumnArea = (
    <>
      {/* Frozen data column headers (sticky-left) — empty while reorderMode is on */}
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
    </>
  );

  return (
    <div
      className="sheet-grid"
      ref={scrollContainerRef}
      style={{ ['--sheet-zoom' as string]: sheetZoom } as React.CSSProperties}
    >
      {/* Header row — sticky-top.
          When reorderMode is active, wrap in DndContext + SortableContext so the
          virtual column headers (SortableHeaderWrapper items) can be dragged.
          autoScroll is enabled so dragging near the edge scrolls the container. */}
      {reorderMode ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={{ threshold: { x: 0.15, y: 0 } }}
        >
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            <div
              className="sheet-header-row"
              style={{ display: 'flex', height: ROW_HEIGHT, position: 'sticky', top: 0, zIndex: 10 }}
            >
              {headerLabelBand}
              {headerColumnArea}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div
          className="sheet-header-row"
          style={{ display: 'flex', height: ROW_HEIGHT, position: 'sticky', top: 0, zIndex: 10 }}
        >
          {/* Frozen-left header label cells — each cell sticky-left only if the
              user's freeze setting includes that column (labelStickyCount). */}
          {headerLabelBand}
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
      )}

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
