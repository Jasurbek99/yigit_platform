import { create } from 'zustand';
import type { ICommentFilter, IRowConfig } from '@/types';

interface IActiveCell {
  shipmentId: number;
  rowKey: string;
}

// In-app clipboard for Sheet copy/cut/paste. Holds the source cell's raw value
// (for type-safe same-field paste) plus its formatted display text (for
// free-text paste and the OS-clipboard mirror).
export interface ISheetClipboardEntry {
  fieldKey: string;
  inputType: string;
  rawValue: unknown;
  displayText: string;
}

// Sheet column (= shipment) filters. All client-side over the loaded sheet
// payload. Country / customer / import firm key on the numeric FK id; export
// firm and block key on their code strings because the Sheet payload carries
// no id for the nested firm_splits / block_sources rows.
export interface ISheetFilters {
  country: number | null;
  customer: number | null;
  importFirm: number | null;
  exportFirm: string | null; // firm_splits[].firm_code
  block: string | null; // block_sources[].block_code
}

const EMPTY_SHEET_FILTERS: ISheetFilters = {
  country: null,
  customer: null,
  importFirm: null,
  exportFirm: null,
  block: null,
};

// v2: frozenColCount semantics changed — it now counts ALL frozen columns
// (Row #, Who, Field name, then shipments) instead of just shipment columns.
// v3 (2026-08-27): the pinned/identity row set shrank from 13 rows to the 5
// that must actually stay visible while scrolling (shipment code + the 4
// destination fields) — see components/sheet/sheetRoleBlocks.ts. Several rows
// that used to be pinned by position (vehicle_condition, documents_status,
// export_code, block_sources, firm_splits, harvest_status, ...) now group
// into a role band instead, which only reaches its full effect once the
// default freeze count matches. Bumping the key resets every browser to the
// new default in one step, the same way v2 did — a user who had already
// customised their freeze count away from 13 would otherwise keep a stale
// value that hides bands 6 rows later than it should. Old
// `ygt-sheet-freeze`/`-v2` are left in localStorage and ignored.
const FREEZE_STORAGE_KEY = 'ygt-sheet-freeze-v3';
export const DEFAULT_FROZEN_ROW_COUNT = 5; // shipment_code + country/customer/city/import_firm
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

// ─── Design variant ─────────────────────────────────────────────────────────
// A purely visual skin over the same grid: identical rows, columns, data and
// permission checks — only the cell/label chrome changes. `ios` mirrors the
// Sera Bütçe "Tır Takip → Tırlar" look (rounded pill fields, soft borders,
// emerald focus ring). Persisted per browser like zoom/freeze; it's a view
// preference, not shared state, so it deliberately does NOT go to the server.
export type TSheetVariant = 'classic' | 'ios';
const VARIANT_STORAGE_KEY = 'ygt-sheet-variant';
const DEFAULT_SHEET_VARIANT: TSheetVariant = 'classic';

function loadVariant(): TSheetVariant {
  if (typeof localStorage === 'undefined') return DEFAULT_SHEET_VARIANT;
  try {
    return localStorage.getItem(VARIANT_STORAGE_KEY) === 'ios' ? 'ios' : DEFAULT_SHEET_VARIANT;
  } catch {
    return DEFAULT_SHEET_VARIANT;
  }
}

function persistVariant(value: TSheetVariant): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(VARIANT_STORAGE_KEY, value);
  } catch {
    // localStorage may throw in private mode or when full — ignore
  }
}

// ─── "Who" label column ─────────────────────────────────────────────────────
// Column B of the label band names the person who owns each row. Hiding it
// buys back its width for shipment columns; the ownership data itself is
// untouched (role bands and permissions read `default_who_key`, not this
// column). Per browser, like zoom/freeze/variant.
const WHO_HIDDEN_STORAGE_KEY = 'ygt-sheet-who-hidden';

function loadWhoHidden(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(WHO_HIDDEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistWhoHidden(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WHO_HIDDEN_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // localStorage may throw in private mode or when full — ignore
  }
}

// ─── iOS-variant row order ──────────────────────────────────────────────────
// The topic order is a fixed preset, but the user can still rearrange it — and
// that rearrangement must NOT reach `UserSheetRowPref`, which is the classic
// sheet's personal order. So it lives here: a map of topic-section label key →
// the field_keys in that section, in order. A field listed under a section
// belongs to it, which is how a row moves BETWEEN sections. Anything absent
// falls back to its default section (see sheetTopicOrder.applyTopicOrder), so
// a partial map is valid and a field added to the sheet later still appears.
// Browser-local, like the variant itself.
export type TIosRowOrder = Record<string, string[]>;
const IOS_ORDER_STORAGE_KEY = 'ygt-sheet-ios-order';

function loadIosRowOrder(): TIosRowOrder | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(IOS_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    // Drop anything that isn't section → string[]; one corrupt entry must not
    // take the whole sheet's order down with it.
    const clean: TIosRowOrder = {};
    for (const [section, fields] of Object.entries(parsed)) {
      if (Array.isArray(fields) && fields.every((f) => typeof f === 'string')) {
        clean[section] = fields;
      }
    }
    return Object.keys(clean).length > 0 ? clean : null;
  } catch {
    return null;
  }
}

function persistIosRowOrder(value: TIosRowOrder | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(IOS_ORDER_STORAGE_KEY);
    else localStorage.setItem(IOS_ORDER_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage may throw in private mode or when full — ignore
  }
}

interface ISheetState {
  activeCell: IActiveCell | null;
  setActiveCell: (cell: IActiveCell | null) => void;
  editingCell: IActiveCell | null;
  // `seed` (Google-Sheets type-to-edit): the printable character that opened
  // the editor. Text/phone/number editors use it as their initial value,
  // replacing the cell's current content. Cleared on every setEditingCell call.
  setEditingCell: (cell: IActiveCell | null, seed?: string) => void;
  editSeed: string | null;
  // Type-to-edit cell→cell hop: when an open editor commits via an arrow key,
  // it sets this to the arrow key name. SheetGrid watches it, moves activeCell
  // one step in that direction (full nav incl. scroll), then clears it. Decouples
  // the editor (which owns commit/save) from the grid (which owns geometry).
  pendingNav: string | null;
  setPendingNav: (navKey: string | null) => void;
  // Sheet clipboard (Ctrl+C/X). Null until the first copy/cut. Lives in the
  // store so paste can read it from anywhere and a future cut-cell highlight can
  // subscribe to it.
  clipboard: ISheetClipboardEntry | null;
  setClipboard: (entry: ISheetClipboardEntry | null) => void;
  searchText: string;
  setSearchText: (text: string) => void;
  showGapyOnly: boolean;
  setShowGapyOnly: (val: boolean) => void;
  sheetFilters: ISheetFilters;
  setSheetFilter: <K extends keyof ISheetFilters>(key: K, value: ISheetFilters[K]) => void;
  resetSheetFilters: () => void;

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

  // ─── "Who" label column visibility ───────────────────────────────────────
  // ─── iOS-variant row order (browser-local; never touches UserSheetRowPref) ─
  iosRowOrder: TIosRowOrder | null;
  setIosRowOrder: (order: TIosRowOrder) => void;
  resetIosRowOrder: () => void;

  whoColumnHidden: boolean;
  setWhoColumnHidden: (hidden: boolean) => void;

  // ─── Design variant (visual skin only — same rows/columns/permissions) ───
  sheetVariant: TSheetVariant;
  setSheetVariant: (variant: TSheetVariant) => void;

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
  /**
   * Clears the drawer's shipment/filter/cell context back to a clean slate
   * (not just `commentsDrawerOpen`). Used by the Detail page's own comments
   * hook on close/unmount — without it, `commentsShipmentId` / `commentsFilter`
   * / `activeCell` keep pointing at the Detail page's last shipment, so the
   * Sheet toolbar's comments button (which falls back to these when no cell
   * is selected) shows a stale, unrelated thread after a Detail visit.
   */
  resetCommentsContext: () => void;

  // ─── Row map (populated from /sheet/ API, used by comment components) ────
  rows: IRowConfig[];
  setRows: (rows: IRowConfig[]) => void;

  // ─── Join mode (select two columns directly in the sheet to join) ─────────
  joinMode: boolean;
  joinSelection: number[];
  setJoinMode: (on: boolean) => void;
  toggleJoinSelection: (id: number) => void;
  clearJoinSelection: () => void;

  // ─── Swap mode (select two columns to swap fields between them) ──────────
  swapMode: boolean;
  swapSelection: number[]; // shipment IDs, max 2
  setSwapMode: (on: boolean) => void;
  toggleSwapSelection: (shipmentId: number) => void;

  // ─── Column reorder mode (drag shipment column headers left/right) ─────────
  // columnOrder: optimistic ordered list of shipment IDs; null = use server order.
  // Lives in the store so SheetGrid's drag-end handler can write it without
  // prop-drilling. Cleared by ShipmentSheet's effect once the server refetch
  // lands with the canonical order.
  columnOrder: number[] | null;
  setColumnOrder: (order: number[] | null) => void;
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
  editSeed: null,
  setEditingCell: (cell, seed) => set({ editingCell: cell, editSeed: seed ?? null }),
  pendingNav: null,
  setPendingNav: (navKey) => set({ pendingNav: navKey }),
  clipboard: null,
  setClipboard: (entry) => set({ clipboard: entry }),
  searchText: '',
  setSearchText: (text) => set({ searchText: text }),
  showGapyOnly: false,
  setShowGapyOnly: (val) => set({ showGapyOnly: val }),
  sheetFilters: { ...EMPTY_SHEET_FILTERS },
  setSheetFilter: (key, value) =>
    set((state) => ({ sheetFilters: { ...state.sheetFilters, [key]: value } })),
  // Clears every column filter, including the Gapy Satyş toggle, so the
  // toolbar's "Clear all" wipes the whole filter set in one action.
  resetSheetFilters: () => set({ sheetFilters: { ...EMPTY_SHEET_FILTERS }, showGapyOnly: false }),

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

  // ─── "Who" label column visibility ────────────────────────────────────────
  iosRowOrder: loadIosRowOrder(),
  setIosRowOrder: (order) => {
    persistIosRowOrder(order);
    set({ iosRowOrder: order });
  },
  resetIosRowOrder: () => {
    persistIosRowOrder(null);
    set({ iosRowOrder: null });
  },

  whoColumnHidden: loadWhoHidden(),
  setWhoColumnHidden: (hidden) => {
    persistWhoHidden(hidden);
    set({ whoColumnHidden: hidden });
  },

  // ─── Design variant ───────────────────────────────────────────────────────
  sheetVariant: loadVariant(),
  setSheetVariant: (variant) => {
    persistVariant(variant);
    set({ sheetVariant: variant });
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

  resetCommentsContext: () =>
    set({
      commentsDrawerOpen: false,
      commentsShipmentId: null,
      commentsFilter: {},
      activeCell: null,
    }),

  // ─── Row map ─────────────────────────────────────────────────────────────
  rows: [],
  setRows: (rows) => set({ rows }),

  // ─── Join mode ───────────────────────────────────────────────────────────
  joinMode: false,
  joinSelection: [],
  setJoinMode: (on) =>
    set(on
      // Clear active/editing cell + optimistic column order when arming join mode;
      // also exit swap mode (mutually exclusive).
      ? { joinMode: true, joinSelection: [], activeCell: null, editingCell: null, columnOrder: null, swapMode: false, swapSelection: [] }
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
      // Already 2 selected — slide the window: drop the oldest, keep the newest
      // pair. Ignoring the click instead (the old behaviour) made a mis-picked
      // pair unrecoverable without leaving join mode — the third column simply
      // never highlighted, which reads as "join is broken".
      return { joinSelection: [current[1], id] };
    }),
  clearJoinSelection: () => set({ joinSelection: [] }),

  // ─── Swap mode ───────────────────────────────────────────────────────────
  swapMode: false,
  swapSelection: [],
  setSwapMode: (on) =>
    set(on
      // Clear active/editing cell + optimistic column order; exit join mode (mutually exclusive).
      ? { swapMode: true, swapSelection: [], activeCell: null, editingCell: null, joinMode: false, joinSelection: [], columnOrder: null }
      : { swapMode: false, swapSelection: [] }
    ),
  toggleSwapSelection: (shipmentId) =>
    set((state) => {
      const current = state.swapSelection;
      if (current.includes(shipmentId)) {
        return { swapSelection: current.filter((x) => x !== shipmentId) };
      }
      if (current.length < 2) {
        return { swapSelection: [...current, shipmentId] };
      }
      // Already 2 selected — FIFO: drop oldest (first), append new
      return { swapSelection: [current[1], shipmentId] };
    }),

  // ─── Column reorder ───────────────────────────────────────────────────────
  // Drag-to-reorder on the column header is always-on (Google-Sheets style)
  // when the user has permission. `columnOrder` is the optimistic local order
  // applied by SheetGrid's drag-end handler and cleared by ShipmentSheet once
  // the server refetch lands with the canonical order.
  columnOrder: null,
  setColumnOrder: (order) => set({ columnOrder: order }),

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
