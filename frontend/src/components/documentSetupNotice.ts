import type { TFunction } from 'i18next';

/** One thing a truck still needs before its documents can be generated. */
export interface ISetupItem {
  /** Label suffix under documents_page.field. */
  key: string;
  /** Shipment-page element id that fills it. */
  anchor: string;
}

const TRUCK_FIELDS = ['driver_name', 'truck_plate'];

/**
 * A document packet's `missing_setup` as things to do. A regular truck's
 * driver and plate come from its Planning trip (transport-trips spec D9/D10),
 * so the two collapse into one «truck» item pointing at the trip block; a
 * gapy truck keeps both as typed fields.
 */
export function setupItems(missing: readonly string[], isGapy: boolean): ISetupItem[] {
  const items: ISetupItem[] = [];
  for (const key of missing) {
    if (!isGapy && TRUCK_FIELDS.includes(key)) {
      if (!items.some((item) => item.key === 'truck')) items.push({ key: 'truck', anchor: 'detail-field-trip_id' });
      continue;
    }
    items.push({ key, anchor: `detail-field-${key}` });
  }
  return items;
}

/**
 * The notice off the shipment page (Documents page, task card): fields filled
 * on the Sheet are listed as such, a missing truck points to a Planning trip.
 * `extraSheetLabels` are already-translated Sheet items (e.g. packing).
 */
export function setupNoticeText(items: ISetupItem[], extraSheetLabels: string[], t: TFunction): string {
  const sheet = [
    ...items.filter((item) => item.key !== 'truck').map((item) => t(`documents_page.field.${item.key}`)),
    ...extraSheetLabels,
  ];
  const parts: string[] = [];
  if (sheet.length > 0) parts.push(t('documents_page.complete_on_sheet', { fields: sheet.join(', ') }));
  if (items.some((item) => item.key === 'truck')) parts.push(t('documents_page.choose_trip'));
  return parts.join(' ');
}
