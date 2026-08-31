/**
 * Sheet layout constants.
 *
 * The legacy `SHEET_ROW_CONFIG` constant was removed when the v2 backend
 * started supplying the row map (`/sheet/`'s `rows` field, snake_case keys
 * matching IRowConfig). Importing the constant from here would have introduced
 * camelCase rows that don't match the backend payload — see
 * commits 7263b07 / 8c02e4a / 529338f for the v2 rollout.
 */
import type { TSheetVariant } from '@/stores/sheetStore';

/** Column widths (px) */
export const COL_WIDTH_ROW_NUM = 28;
export const COL_WIDTH_WHO = 120;
export const COL_WIDTH_FIELD = 210;
export const COL_WIDTH_SHIPMENT = 145;
export const FROZEN_LEFT_TOTAL = COL_WIDTH_ROW_NUM + COL_WIDTH_WHO + COL_WIDTH_FIELD; // 358px

/** Row height (px) */
export const ROW_HEIGHT = 36;

/**
 * Per-variant density multipliers.
 *
 * The `ios` skin renders every editable cell as a padded pill field, so its
 * rows and columns need more room. Row height MUST come from here rather than
 * from CSS padding: the grid is virtualized and `sheet-frozen-top` is pinned at
 * `top: rowHeight`, so a height the JS doesn't know about desyncs the measured
 * row offsets from what is painted.
 */
const VARIANT_DENSITY: Record<TSheetVariant, { row: number; col: number }> = {
  classic: { row: 1, col: 1 },
  ios: { row: 1.35, col: 1.15 },
};

/**
 * Scale the layout constants by a zoom factor.
 *
 * The sheet is virtualized, so zoom CANNOT be done with CSS `zoom`/`transform`
 * on the scroll container — that desyncs scrollLeft from getBoundingClientRect
 * and breaks @tanstack/react-virtual. Instead every component that lays out
 * cells reads the same zoom from the store and scales these px constants, so
 * the virtualizer's `estimateSize` and the rendered widths stay in lockstep.
 * Fonts/padding scale separately via the `--sheet-zoom` CSS variable.
 */
export function scaleSheetLayout(
  zoom: number,
  variant: TSheetVariant = 'classic',
  whoColumnHidden: boolean = false,
) {
  const d = VARIANT_DENSITY[variant] ?? VARIANT_DENSITY.classic;
  const colRowNum = Math.round(COL_WIDTH_ROW_NUM * zoom);
  // A hidden Who column is a zero-width slot, not a removed one: `frozenLeftTotal`
  // and the Field column's sticky `left` are both sums over these widths, so
  // zeroing it shifts everything correctly without changing the 3-slot model the
  // freeze setting (`frozenColCount`) is expressed in.
  const colWho = whoColumnHidden ? 0 : Math.round(COL_WIDTH_WHO * zoom);
  const colField = Math.round(COL_WIDTH_FIELD * zoom);
  return {
    colRowNum,
    colWho,
    colField,
    colShipment: Math.round(COL_WIDTH_SHIPMENT * d.col * zoom),
    frozenLeftTotal: colRowNum + colWho + colField,
    rowHeight: Math.round(ROW_HEIGHT * d.row * zoom),
    // Exposed so per-row overrides (e.g. an admin's custom cell width) can be
    // scaled by the same factor and keep tracking their column slot.
    density: d,
  } as const;
}

/** Vehicle condition options */
export const VEHICLE_CONDITION_OPTIONS = [
  { value: 'OK', label: 'OK' },
  { value: 'ISSUE', label: 'Issue' },
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'RETURNED', label: 'Returned' },
];
