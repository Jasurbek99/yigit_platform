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
  ISheetCommentCounts,
  ISheetTaskCounts,
  ICommentTaskStatus,
  ISheetRowSettingForUser,
  ICellLastEdit,
} from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useAuth } from '@/hooks/useAuth';
import { isCellEditable } from '@/utils/sheetPermissions';
import { useSheetClipboard } from '@/hooks/useSheetClipboard';
import { useApplyUndo } from '@/hooks/useApplyUndo';
import { useSaveSheetColumnOrder } from '@/hooks/useShipmentSheet';
import { SheetCell } from './SheetCell';
import { SheetCellEditor } from './SheetCellEditor';
import { SheetLabelRow } from './SheetLabelColumn';
import { SheetColumnHeader } from './SheetColumnHeader';
import { scaleSheetLayout } from '@/constants/sheetRowConfig';
import { getContrastTextColor, mixWithWhite } from '@/utils/contrastColor';

// The column tint is rendered as `color-mix(in srgb, <pick> 60%, var(--surface))`
// — JS-side mirror so we can compute the contrast color against the *rendered*
// blend, not the raw pick. Keep this in sync with the rule in SheetStyles.css.
const COL_TINT_PICK_WEIGHT = 0.6;

// ─── Sortable column header wrapper ──────────────────────────────────────────
// Drag-to-reorder is always-on for authorized users (Google-Sheets style).
// `activationConstraint: { distance: 5 }` on the PointerSensor means a click
// (no movement) still fires normally — color picker, delete, soft-delete, and
// join/swap selection clicks on the header all work without entering a "mode".
// A drag only starts after the pointer moves >5px.

interface ISortableHeaderWrapperProps {
  shipmentId: number;
  children: React.ReactNode;
  /** Extra class names forwarded from the outer header container. */
  className: string;
  style: React.CSSProperties;
  onClick?: () => void;
  /** When true, drag is disabled (e.g. while join/swap mode is active). */
  disabled?: boolean;
}

function SortableHeaderWrapper({
  shipmentId,
  children,
  className,
  style,
  onClick,
  disabled = false,
}: ISortableHeaderWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shipmentId, disabled });

  const combinedStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: disabled ? style.cursor : isDragging ? 'grabbing' : 'grab',
    userSelect: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      className={`${className} sheet-col-header--sortable`}
      style={combinedStyle}
      onClick={onClick}
      {...attributes}
      {...(disabled ? {} : listeners)}
    >
      {children}
    </div>
  );
}

// Roles whose columns get a supply-side green tint in the Sheet.
const SUPPLY_ROLES = new Set(['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']);

function isSupplyColumn(shipment: IShipmentSheetItem): boolean {
  return SUPPLY_ROLES.has(shipment.created_by_role ?? '');
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
  const setColumnOrder = useSheetStore((s) => s.setColumnOrder);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ─── Column reorder: dnd-kit setup ──────────────────────────────────────
  // Drag-to-reorder on the column header is always-on for authorized users
  // (Google-Sheets style). PointerSensor `activationConstraint: { distance: 5 }`
  // means a click (no movement) doesn't accidentally start a drag — the color
  // picker, delete button, and join/swap selection clicks all keep working.
  // Drag is disabled while join/swap mode is active so the two interactions
  // (column selection vs reorder) don't compete for the same gesture.
  const userRole = user?.role ?? '';
  // Column reorder writes a GLOBAL order visible to all users, so it is gated
  // to the operational roles that actually live in the Sheet day-to-day:
  // export_manager, document_team, loading_dept_head — plus admin/superuser.
  const canReorderColumns =
    !!user && (
      user.is_superuser ||
      ['admin', 'export_manager', 'document_team', 'loading_dept_head', 'loading_dept_head_deputy'].includes(userRole)
    );
  // Row STYLE editing from the Sheet gear writes the GLOBAL SheetRowSetting
  // (affects every user), so it is gated to the settings-managing roles that
  // also own the admin Sheet-Rows tab + the backend shipment-edit permission.
  const canEditRowStyle =
    !!user && (
      user.is_superuser ||
      ['admin', 'director', 'export_manager'].includes(userRole)
    );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const reorderEnabled = canReorderColumns && !joinMode && !swapMode;
  const saveColumnOrder = useSaveSheetColumnOrder();

  // Google-Sheets clipboard for the active cell: Ctrl+C / X / V + Delete.
  const { copyActiveCell, cutActiveCell, pasteActiveCell, deleteActiveCell } =
    useSheetClipboard(shipments, rows, rowSettings, user);

  // Ctrl+Z (undo) — pops the last Sheet cell write and replays its reverse.
  const applyUndo = useApplyUndo(shipments, rows);

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
  // Frozen shipments stay frozen even when reorder is enabled. Only the
  // scrollable (non-frozen) shipment columns participate in the SortableContext;
  // a user who wants to reorder a currently-frozen column lowers their freeze
  // count first. This matches Google Sheets, where frozen columns aren't part
  // of the same drag track as the scrollable ones.
  const shipmentFreezeCount = Math.max(0, safeFrozenColCount - TOTAL_LABEL_COLS);

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
  // Move activeCell one step in the arrow direction, skipping gapy-hidden cells
  // and scrolling the new cell into view. Returns true if the selection moved.
  // Shared by the keydown listener (bare navigation) and the pendingNav effect
  // (the editor's commit-and-hop on type-to-edit). Reads/writes the store via
  // getState() so it isn't a render-tied closure over activeCell.
  const navigateActiveCell = useCallback(
    (navKey: string): boolean => {
      const stepRow =
        navKey === 'ArrowUp' ? -1 : navKey === 'ArrowDown' ? 1 : 0;
      const stepCol =
        navKey === 'ArrowLeft' ? -1 : navKey === 'ArrowRight' ? 1 : 0;
      if (stepRow === 0 && stepCol === 0) return false;

      const state = useSheetStore.getState();
      const active = state.activeCell;
      if (!active) return false;

      const rowIdx = rows.findIndex((r) => r.field_key === active.rowKey);
      const shipmentIdx = shipments.findIndex((s) => s.id === active.shipmentId);
      if (rowIdx === -1 || shipmentIdx === -1) return false;

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
      if (!found) return false;

      state.setActiveCell({
        shipmentId: shipments[newCol].id,
        rowKey: rows[newRow].field_key,
      });

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
      return true;
    },
    [
      rows,
      shipments,
      shipmentFreezeCount,
      safeFrozenRowCount,
      ROW_HEIGHT,
      columnVirtualizer,
    ],
  );

  // The editor signals a commit-and-hop by setting pendingNav (the arrow key it
  // committed on). Consume it once the editor has closed: move the selection,
  // then clear the flag so it fires exactly once.
  const pendingNav = useSheetStore((s) => s.pendingNav);
  const setPendingNav = useSheetStore((s) => s.setPendingNav);
  useEffect(() => {
    if (!pendingNav) return;
    // Wait for the committing editor to actually close before hopping. For most
    // cells save() closes synchronously, but custom_* fields close only in the
    // mutation's onSuccess — navigating early would highlight the next cell
    // while the old editor is still mounted. editingCell is a dep so this
    // re-runs and fires the hop once the editor unmounts.
    if (editingCell) return;
    navigateActiveCell(pendingNav);
    setPendingNav(null);
  }, [pendingNav, editingCell, navigateActiveCell, setPendingNav]);

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
      // Don't intercept keystrokes targeted at form controls or
      // contenteditable surfaces (cell editor inputs, comments composer,
      // search box, etc.) — native copy/paste/typing must win there.
      const target = e.target as HTMLElement | null;
      const inFormControl =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (inFormControl) return;

      const state = useSheetStore.getState();

      // ─── Undo (Ctrl/⌘+Z) ──────────────────────────────────────────────────
      // Grid-global (no active cell needed). Reserves Ctrl+Shift+Z for a future
      // redo. Skipped while editing (native input undo wins) or in join/swap.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === 'KeyZ' &&
        !state.editingCell &&
        !state.joinMode &&
        !state.swapMode
      ) {
        void applyUndo();
        e.preventDefault();
        return;
      }

      // ─── Clipboard + Delete shortcuts ─────────────────────────────────────
      // Handled before nav/type-to-edit so Ctrl+C/X/V and Delete don't fall
      // through to the editor-open path. Only act on the active cell while not
      // editing and not in column join/swap selection.
      if (state.activeCell && !state.editingCell && !state.joinMode && !state.swapMode) {
        // Exclude Shift so Ctrl+Shift+C/V/X (browser/OS shortcuts like
        // paste-without-formatting) aren't hijacked by the cell clipboard.
        const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
        // Match on e.code (physical key), NOT e.key: on Russian / Kazakh layouts
        // Ctrl+C yields e.key === 'с' (Cyrillic), which would never match 'c'.
        // e.code is layout-independent, exactly like the OS copy/paste binding.
        if (mod && e.code === 'KeyC') {
          copyActiveCell();
          e.preventDefault();
          return;
        }
        if (mod && e.code === 'KeyX') {
          cutActiveCell();
          e.preventDefault();
          return;
        }
        if (mod && e.code === 'KeyV') {
          void pasteActiveCell();
          e.preventDefault();
          return;
        }
        if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
          deleteActiveCell();
          e.preventDefault();
          return;
        }
      }

      const isNav = NAV_KEYS.has(e.key);
      // Type-to-edit (Google Sheets): a single printable character on the
      // active cell opens its editor seeded with that character. Permit AltGr
      // (Ctrl+Alt → real glyph, e.g. Turkmen ş/ç/ý/ň on some layouts) while
      // still rejecting Ctrl/Meta shortcuts like Ctrl+C.
      const isPrintable =
        e.key.length === 1 && !e.metaKey && !(e.ctrlKey && !e.altKey);
      if (!isNav && !isPrintable) return;
      // Nav keys must not carry modifiers; the printable path handles its own.
      if (isNav && (e.altKey || e.ctrlKey || e.metaKey)) return;

      if (state.editingCell) return;
      if (state.joinMode || state.swapMode) return;

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

      // Printable character → open the editor seeded with the typed glyph.
      // Text/phone/number editors replace their content with the seed; the
      // dropdown/date editors ignore it and just open (first char dropped).
      if (isPrintable) {
        const rowConfig = rows[rowIdx];
        if (rowConfig?.input_type !== 'readonly') {
          state.setEditingCell(
            { shipmentId: active.shipmentId, rowKey: active.rowKey },
            e.key,
          );
          e.preventDefault();
        }
        return;
      }

      if (navigateActiveCell(e.key)) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    rows,
    shipments,
    navigateActiveCell,
    copyActiveCell,
    cutActiveCell,
    pasteActiveCell,
    deleteActiveCell,
    applyUndo,
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

      // Shared with the clipboard hook so cut / paste / Delete obey the same
      // gate as inline editing (backend v2 decision, else legacy field check).
      const isEditable = isCellEditable(rowConfig, rowSettings, user);

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

  // Frozen data column headers (sticky-left). Frozen columns are not part of
  // the SortableContext, so they aren't draggable; a user who wants to reorder
  // a frozen column lowers their freeze count first.
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
              officialExportCode={shipment.official_export_code}
              columnColor={shipment.column_color}
              isCancelled={cancelled}
            />
          </div>
        );
      }),
    [frozenShipments, COL_WIDTH_SHIPMENT, FROZEN_LEFT_TOTAL, ROW_HEIGHT, joinMode, joinSelection, toggleJoinSelection, swapMode, swapSelection, toggleSwapSelection],
  );

  // Virtualized (scrollable) column headers — seq number continues from frozen count.
  // For authorized users (canReorderColumns), each scrollable header is a
  // SortableHeaderWrapper so it can be dragged inline (no mode toggle needed).
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
            officialExportCode={shipment.official_export_code}
            columnColor={shipment.column_color}
            isCancelled={cancelled}
          />
        );

        const handleJoinClick = swapMode
          ? () => toggleSwapSelection(shipment.id)
          : joinMode && isDraft
          ? () => toggleJoinSelection(shipment.id)
          : undefined;

        if (canReorderColumns) {
          // Drag-to-reorder is always-on for authorized users (Google-Sheets
          // style). The SortableHeaderWrapper adds a CSS transform on top of the
          // absolute `left: vc.start` base position during drag. Drag is disabled
          // while join/swap mode is active so clicks-for-selection don't compete
          // with drag-for-reorder.
          return (
            <SortableHeaderWrapper
              key={shipment.id}
              shipmentId={shipment.id}
              className={headerClassName}
              style={headerStyle}
              onClick={handleJoinClick}
              disabled={joinMode || swapMode}
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
    [virtualColumns, scrollableShipments, shipmentFreezeCount, COL_WIDTH_SHIPMENT, ROW_HEIGHT, joinMode, joinSelection, toggleJoinSelection, swapMode, swapSelection, toggleSwapSelection, canReorderColumns],
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
              hasReorderCapability && rowHasId ? handleReorderTo : undefined
            }
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
            canEditRowStyle={canEditRowStyle}
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
                    ? ({
                        ['--col-tint' as string]: shipment.column_color,
                        ['--col-tint-fg' as string]: getContrastTextColor(
                          mixWithWhite(shipment.column_color, COL_TINT_PICK_WEIGHT),
                        ),
                      } as React.CSSProperties)
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
                      ? ({
                          ['--col-tint' as string]: shipment.column_color,
                          ['--col-tint-fg' as string]: getContrastTextColor(
                            mixWithWhite(shipment.column_color, COL_TINT_PICK_WEIGHT),
                          ),
                        } as React.CSSProperties)
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
        {t('sheet.row.export_code')}
      </div>
    </>
  );

  const headerColumnArea = (
    <>
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
    </>
  );

  const headerRow = (
    <div
      className="sheet-header-row"
      style={{ display: 'flex', height: ROW_HEIGHT, position: 'sticky', top: 0, zIndex: 10 }}
    >
      {/* Frozen-left header label cells — each cell sticky-left only if the
          user's freeze setting includes that column (labelStickyCount). */}
      {headerLabelBand}
      {headerColumnArea}
    </div>
  );

  return (
    <div
      className="sheet-grid"
      ref={scrollContainerRef}
      style={{ ['--sheet-zoom' as string]: sheetZoom } as React.CSSProperties}
    >
      {/* Header row — sticky-top.
          For authorized users, wrap in DndContext + SortableContext so the
          virtual column headers (SortableHeaderWrapper items) can be dragged
          inline (Google-Sheets style, no mode toggle). PointerSensor's 5px
          activation distance keeps clicks on color-picker / delete / join /
          swap controls working untouched. autoScroll is enabled so dragging
          near the edge scrolls the container. */}
      {reorderEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={{ threshold: { x: 0.15, y: 0 } }}
        >
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            {headerRow}
          </SortableContext>
        </DndContext>
      ) : (
        headerRow
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
