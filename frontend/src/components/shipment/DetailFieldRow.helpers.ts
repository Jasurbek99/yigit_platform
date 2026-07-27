import type { FieldInputType } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';

export type SaveState = 'idle' | 'pending' | 'saved' | 'error';

interface IDeriveSaveStateArgs {
  isPending: boolean;
  isError: boolean;
  hasSavedOnce: boolean;
}

/**
 * Collapse the mutation flags into the one state the row renders.
 *
 * Precedence is pending > error > saved > idle: an in-flight retry must not
 * keep showing the previous failure, and a success must not be erased by a
 * later unrelated render.
 */
export function deriveSaveState({
  isPending,
  isError,
  hasSavedOnce,
}: IDeriveSaveStateArgs): SaveState {
  if (isPending) return 'pending';
  if (isError) return 'error';
  if (hasSavedOnce) return 'saved';
  return 'idle';
}

const AUTO_OPEN_TYPES = new Set<FieldInputType>([
  'select',
  'option_select',
  'date',
  'datetime',
]);

/**
 * Should entering edit mode immediately open this input's popup?
 *
 * True for pickers, so one click both enters edit mode and opens the list.
 * False for free text (the user still has to type) and for booleans, which
 * are toggled directly and never enter an edit state at all.
 */
export function shouldAutoOpenEditor(inputType: FieldInputType): boolean {
  return AUTO_OPEN_TYPES.has(inputType);
}

/** Keys of IShipmentDetail whose value is a plain string (or null) — the
 * only shape valid as a read-mode display fallback for an FK field. */
type StringFieldKey = {
  [K in keyof IShipmentDetail]: IShipmentDetail[K] extends string | null ? K : never;
}[keyof IShipmentDetail];

/**
 * Config key → the sibling field on `IShipmentDetail` holding the
 * human-readable display string for that FK. Per api-contract.md, every FK
 * returns both the raw id (bound by the editor) and a `_name`/`_display`
 * string (rendered in read mode). Fields not listed here either have no
 * display sibling (option-code fields resolved from `ShipmentOptionType`)
 * or aren't FK/code fields at all.
 */
export const READ_DISPLAY_FIELD_MAP: Partial<Record<string, StringFieldKey>> = {
  country: 'country_name',
  customer: 'customer_name',
  city: 'city_name',
  import_firm: 'import_firm_name',
  border_point: 'border_point_name',
  variety: 'variety_name',
  vehicle_responsible: 'vehicle_responsible_display',
};

/**
 * Resolve the read-mode display string for a field.
 *
 * - `customs_clearance_planned_day` stores a weekday code ('mon'..'sun') —
 *   translate it via the caller-supplied i18n lookup rather than a data
 *   sibling (there isn't one).
 * - Fields in READ_DISPLAY_FIELD_MAP show their `_name`/`_display` sibling.
 *   If that sibling is null but the id itself is set (data inconsistency —
 *   e.g. an FK pointing at a row with no name), fall back to the raw id
 *   rather than rendering a blank cell.
 * - Every other field returns undefined, so DetailFieldValue renders exactly
 *   as it did before this existed (raw persisted value / '—').
 */
export function resolveReadDisplay(
  fieldKey: string,
  shipment: IShipmentDetail,
  persisted: unknown,
  translateWeekday: (day: string) => string,
): string | undefined {
  if (fieldKey === 'customs_clearance_planned_day') {
    return typeof persisted === 'string' && persisted ? translateWeekday(persisted) : undefined;
  }
  const displayKey = READ_DISPLAY_FIELD_MAP[fieldKey];
  if (!displayKey) return undefined;
  const displayValue = shipment[displayKey];
  if (displayValue) return displayValue;
  if (persisted != null && persisted !== '') return String(persisted);
  return undefined;
}
