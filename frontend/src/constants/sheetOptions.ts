/**
 * Registry of static option arrays for sheet dropdown rows.
 * Keyed by the `options_source` value from the backend row definition.
 *
 * Most dropdowns fetch their options dynamically (countries, customers, firms,
 * blocks, etc.) — those are handled in SheetCellEditor via dedicated hooks.
 * Only "enum-style" options that never change are listed here.
 *
 * `vehicleCondition` is the canonical key — must match backend sheet_rows.py.
 */
export const VEHICLE_CONDITION_OPTIONS = [
  { value: 'OK', label: 'OK' },
  { value: 'ISSUE', label: 'Issue' },
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'RETURNED', label: 'Returned' },
] as const;

export const SHEET_OPTIONS_REGISTRY: Record<string, readonly { value: string; label: string }[]> = {
  vehicleCondition: VEHICLE_CONDITION_OPTIONS,
  // future static registrations here
};

/**
 * Swatches offered by every Sheet color picker (column tint and per-cell
 * background). Pale on purpose: cell text stays legible without relying on the
 * WCAG auto-contrast fallback.
 */
export const SHEET_PRESET_COLORS = [
  '#fee2e2', '#fef3c7', '#fef9c3', '#dcfce7', '#dbeafe',
  '#e0e7ff', '#fce7f3', '#f3e8ff', '#e5e7eb', '#fed7aa',
];
