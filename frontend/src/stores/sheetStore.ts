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

// ─── Zoom (cell + font scale, like Google Sheets' View › Zoom) ─────────────
// We scale the layout constants in JS (not CSS `zoom`/`transform`) because the
// sheet is virtualized: a CSS transform on the scroll container desyncs
// scrollLeft from getBoundingClientRect and silently breaks @tanstack/react-virtual.
const ZOOM_STORAGE_KEY = 'ygt-sheet-zoom';
export const SHEET_ZOOM_MIN = 0.6;
export const SHEET_ZOOM_MAX = 1.5;
export const SHEET_ZOOM_STEP = 0.1;
const DEFAULT_SHEET_ZOOM = 1;

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SHEET_ZOOM;
  const clamped = Math.min(SHEET_ZOOM_MAX, Math.max(SHEET_ZOOM_MIN, value));
  // Round to 2 decimals so 0.1 steps don't accumulate float drift (0.7000001).
  return Math.round(clamped * 100) / 100;
}

function loadZoom(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_SHEET_ZOOM;
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (!raw) return DEFAULT_SHEET_ZOOM;
    return clampZoom(parseFloat(raw));
  } catch {
    return DEFAULT_SHEET_ZOOM;
  }
}

function persistZoom(value: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(value));
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

  // ─── Zoom (scales cell dimensions + fonts) ──────────────────────────────
  sheetZoom: number;
  setSheetZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  // ─── Fullscreen (distraction-free grid: hides app chrome + toolbar) ──────
  // Ephemeral — a per-session view choice, not persisted across reloads.
  sheetFullscreen: boolean;
  setSheetFullscreen: (on: boolean) => void;
  toggleSheetFullscreen: () => void;

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

  // ─── Join mode (select two columns directly in the sheet to join) ─────────
  joinMode: boolean;
  joinSelection: number[];
  setJoinMode: (on: boolean) => void;
  toggleJoinSelection: (id: number) => void;
  clearJoinSelection: () => void;
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

  // ─── Zoom ─────────────────────────────────────────────────────────────────
  sheetZoom: loadZoom(),
  setSheetZoom: (zoom) => {
    const clamped = clampZoom(zoom);
    persistZoom(clamped);
    set({ sheetZoom: clamped });
  },
  zoomIn: () =>
    set((state) => {
      const clamped = clampZoom(state.sheetZoom + SHEET_ZOOM_STEP);
      persistZoom(clamped);
      return { sheetZoom: clamped };
    }),
  zoomOut: () =>
    set((state) => {
      const clamped = clampZoom(state.sheetZoom - SHEET_ZOOM_STEP);
      persistZoom(clamped);
      return { sheetZoom: clamped };
    }),
  resetZoom: () => {
    persistZoom(DEFAULT_SHEET_ZOOM);
    set({ sheetZoom: DEFAULT_SHEET_ZOOM });
  },

  // ─── Fullscreen ───────────────────────────────────────────────────────────
  sheetFullscreen: false,
  setSheetFullscreen: (on) => set({ sheetFullscreen: on }),
  toggleSheetFullscreen: () => set((state) => ({ sheetFullscreen: !state.sheetFullscreen })),

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

  // ─── Join mode ───────────────────────────────────────────────────────────
  joinMode: false,
  joinSelection: [],
  setJoinMode: (on) =>
    set(on
      // Clear active/editing cell when arming join mode
      ? { joinMode: true, joinSelection: [], activeCell: null, editingCell: null }
      : { joinMode: false, joinSelection: [] }
    ),
  toggleJoinSelection: (id) =>
    set((state) => {
      const current = state.joinSelection;
      if (current.includes(id)) {
        return { joinSelection: current.filter((x) => x !== id) };
      }
      if (current.length < 2) {
        return { joinSelection: [...current, id] };
      }
      // Already 2 selected — ignore
      return {};
    }),
  clearJoinSelection: () => set({ joinSelection: [] }),

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
