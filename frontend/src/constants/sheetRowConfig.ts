/**
 * Sheet layout constants.
 *
 * The legacy `SHEET_ROW_CONFIG` constant was removed when the v2 backend
 * started supplying the row map (`/sheet/`'s `rows` field, snake_case keys
 * matching IRowConfig). Importing the constant from here would have introduced
 * camelCase rows that don't match the backend payload — see
 * commits 7263b07 / 8c02e4a / 529338f for the v2 rollout.
 */

/** Column widths (px) */
export const COL_WIDTH_ROW_NUM = 28;
export const COL_WIDTH_WHO = 120;
export const COL_WIDTH_FIELD = 210;
export const COL_WIDTH_SHIPMENT = 145;
export const FROZEN_LEFT_TOTAL = COL_WIDTH_ROW_NUM + COL_WIDTH_WHO + COL_WIDTH_FIELD; // 358px

/** Row height (px) */
export const ROW_HEIGHT = 36;

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
export function scaleSheetLayout(zoom: number) {
  const colRowNum = Math.round(COL_WIDTH_ROW_NUM * zoom);
  const colWho = Math.round(COL_WIDTH_WHO * zoom);
  const colField = Math.round(COL_WIDTH_FIELD * zoom);
  return {
    colRowNum,
    colWho,
    colField,
    colShipment: Math.round(COL_WIDTH_SHIPMENT * zoom),
    frozenLeftTotal: colRowNum + colWho + colField,
    rowHeight: Math.round(ROW_HEIGHT * zoom),
  } as const;
}

/** Vehicle condition options */
export const VEHICLE_CONDITION_OPTIONS = [
  { value: 'OK', label: 'OK' },
  { value: 'ISSUE', label: 'Issue' },
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'RETURNED', label: 'Returned' },
];
