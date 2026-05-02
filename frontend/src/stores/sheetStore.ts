import { create } from 'zustand';
import type { ICommentFilter, IRowConfig } from '@/types';

interface IActiveCell {
  shipmentId: number;
  rowKey: string;
}

// v2: frozenColCount semantics changed — it now counts ALL frozen columns
// (Row #, Who, Field name, then shipments) instead of just shipment columns.
// Bumping the key resets old values so users don't jump from "label band
// frozen" to "nothing frozen" silently. Old `ygt-sheet-freeze` is left in
// localStorage and ignored.
const FREEZE_STORAGE_KEY = 'ygt-sheet-freeze-v2';
const DEFAULT_FROZEN_ROW_COUNT = 13; // rows 2–14 — Identity & Planning band
// 3 = Row # + Who + Field name. Matches the v1 default visual: label band is
// sticky-left, no shipments frozen.
const DEFAULT_FROZEN_COL_COUNT = 3;

interface IFreezeState {
  frozenRowCount: number;
  frozenColCount: number;
}

function loadFreezeState(): IFreezeState {
  if (typeof localStorage === 'undefined') {
    return { frozenRowCount: DEFAULT_FROZEN_ROW_COUNT, frozenColCount: DEFAULT_FROZEN_COL_COUNT };
  }
  try {
    const raw = localStorage.getItem(FREEZE_STORAGE_KEY);
    if (!raw) {
      return { frozenRowCount: DEFAULT_FROZEN_ROW_COUNT, frozenColCount: DEFAULT_FROZEN_COL_COUNT };
    }
    const parsed = JSON.parse(raw) as Partial<IFreezeState>;
    return {
      frozenRowCount:
        typeof parsed.frozenRowCount === 'number' && parsed.frozenRowCount >= 0
          ? parsed.frozenRowCount
          : DEFAULT_FROZEN_ROW_COUNT,
      frozenColCount:
        typeof parsed.frozenColCount === 'number' && parsed.frozenColCount >= 0
          ? parsed.frozenColCount
          : DEFAULT_FROZEN_COL_COUNT,
    };
  } catch {
    return { frozenRowCount: DEFAULT_FROZEN_ROW_COUNT, frozenColCount: DEFAULT_FROZEN_COL_COUNT };
  }
}

function persistFreezeState(state: IFreezeState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FREEZE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may throw in private mode or when full — ignore
  }
}

interface ISheetState {
  activeCell: IActiveCell | null;
  setActiveCell: (cell: IActiveCell | null) => void;
  editingCell: IActiveCell | null;
  setEditingCell: (cell: IActiveCell | null) => void;
  searchText: string;
  setSearchText: (text: string) => void;
  showGapyOnly: boolean;
  setShowGapyOnly: (val: boolean) => void;

  // ─── Freeze panes (configurable like Google Sheets) ─────────────────────
  frozenRowCount: number;
  frozenColCount: number;
  setFrozenRowCount: (count: number) => void;
  setFrozenColCount: (count: number) => void;

  // ─── Comments drawer ─────────────────────────────────────────────────────
  commentsDrawerOpen: boolean;
  setCommentsDrawerOpen: (open: boolean) => void;
  commentsShipmentId: number | null;
  setCommentsShipmentId: (id: number | null) => void;
  commentsFilter: ICommentFilter;
  setCommentsFilter: (filter: ICommentFilter) => void;
  /** Set by deep-link; cleared after scroll-into-view */
  pendingHighlightCommentId: number | null;
  setPendingHighlightCommentId: (id: number | null) => void;
  /** Open drawer for a specific cell on a specific shipment */
  openCommentsForCell: (shipmentId: number, fieldKey: string) => void;
  /** Open drawer showing all comments for a shipment (no cell filter) */
  openCommentsForShipment: (shipmentId: number) => void;
  /** Toggle the drawer; uses the active cell's shipment+field as context when opening */
  toggleCommentsDrawer: () => void;

  // ─── Row map (populated from /sheet/ API, used by comment components) ────
  rows: IRowConfig[];
  setRows: (rows: IRowConfig[]) => void;
}

const initialFreeze = loadFreezeState();

export const useSheetStore = create<ISheetState>((set) => ({
  activeCell: null,
  // Selecting a cell also seeds the comments drawer's shipment context so the
  // composer is enabled the moment the user opens the drawer from the toolbar.
  setActiveCell: (cell) =>
    set((state) => ({
      activeCell: cell,
      commentsShipmentId: cell?.shipmentId ?? state.commentsShipmentId,
    })),
  editingCell: null,
  setEditingCell: (cell) => set({ editingCell: cell }),
  searchText: '',
  setSearchText: (text) => set({ searchText: text }),
  showGapyOnly: false,
  setShowGapyOnly: (val) => set({ showGapyOnly: val }),

  // ─── Freeze panes ───────────────────────────────────────────────────────
  frozenRowCount: initialFreeze.frozenRowCount,
  frozenColCount: initialFreeze.frozenColCount,
  setFrozenRowCount: (count) =>
    set((state) => {
      const clamped = Math.max(0, Math.floor(count));
      persistFreezeState({ frozenRowCount: clamped, frozenColCount: state.frozenColCount });
      return { frozenRowCount: clamped };
    }),
  setFrozenColCount: (count) =>
    set((state) => {
      const clamped = Math.max(0, Math.floor(count));
      persistFreezeState({ frozenRowCount: state.frozenRowCount, frozenColCount: clamped });
      return { frozenColCount: clamped };
    }),

  // ─── Comments drawer ─────────────────────────────────────────────────────
  commentsDrawerOpen: false,
  setCommentsDrawerOpen: (open) => set({ commentsDrawerOpen: open }),
  commentsShipmentId: null,
  setCommentsShipmentId: (id) => set({ commentsShipmentId: id }),
  commentsFilter: {},
  setCommentsFilter: (filter) => set({ commentsFilter: filter }),
  pendingHighlightCommentId: null,
  setPendingHighlightCommentId: (id) => set({ pendingHighlightCommentId: id }),

  openCommentsForCell: (shipmentId, fieldKey) =>
    set({
      commentsDrawerOpen: true,
      commentsShipmentId: shipmentId,
      commentsFilter: { fieldKey },
      // The composer reads activeCell to compute the pin target. Without
      // syncing it here, comments authored from the hover icon would post
      // without a field_key and the cell would never get a marker.
      activeCell: { shipmentId, rowKey: fieldKey },
    }),

  openCommentsForShipment: (shipmentId) =>
    set({
      commentsDrawerOpen: true,
      commentsShipmentId: shipmentId,
      commentsFilter: {},
    }),

  // ─── Row map ─────────────────────────────────────────────────────────────
  rows: [],
  setRows: (rows) => set({ rows }),

  toggleCommentsDrawer: () =>
    set((state) => {
      const opening = !state.commentsDrawerOpen;
      if (!opening) {
        return { commentsDrawerOpen: false };
      }
      // When opening from the toolbar, prefill context from the active cell
      // so the composer is immediately usable and pinned to that cell.
      return {
        commentsDrawerOpen: true,
        commentsShipmentId:
          state.activeCell?.shipmentId ?? state.commentsShipmentId,
        commentsFilter: state.activeCell
          ? { fieldKey: state.activeCell.rowKey }
          : state.commentsFilter,
      };
    }),
}));
