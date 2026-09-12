import dayjs from 'dayjs';
import i18n from '@/i18n';
import type { IShipmentSheetItem, IRowConfig, IShipmentOptionType } from '@/types';

/**
 * Returns the canonical display string for a shipment cell.
 *
 * This is the single source of truth for converting raw IShipmentSheetItem
 * data into display text for a given row. Used by:
 *   - SheetCell.tsx  (the Sheet grid)
 *   - SelfBoardShipmentFieldList.tsx  (the task drawer field list)
 *
 * The function always returns a string — callers render "—" when it equals '—'.
 *
 * `options` is optional: when provided, option-list codes for status fields
 * (harvest_status, documents_status) are resolved to their Turkmen label
 * (`label_tk`). Statuses are intentionally Turkmen-only regardless of UI locale.
 */
export function getCellValue(
  shipment: IShipmentSheetItem,
  rowConfig: IRowConfig,
  options?: IShipmentOptionType[],
): string {
  const { field_key: fieldKey } = rowConfig;

  // Phase 5c: admin-created custom rows store free-text values in
  // shipment.custom_fields keyed by field_key (always 'custom_*'). Branch
  // here before the switch so the legacy switch never has to know about
  // dynamic field_keys.
  if (fieldKey.startsWith('custom_')) {
    const value = shipment.custom_fields?.[fieldKey];
    return value && value.length > 0 ? value : '—';
  }

  switch (fieldKey) {
    case 'shipment_code':
      return shipment.shipment_code;
    case 'export_code':
      return shipment.export_code ?? '—';
    case 'country':
      return shipment.country_name ?? '—';
    case 'customer':
      return shipment.customer_name ?? '—';
    case 'city':
      return shipment.city_name ?? '—';
    case 'import_firm':
      return shipment.import_firm_name ?? '—';
    case 'packing':
      // Synthetic popover cell (unified packing panel) — no copyable text.
      return '';
    case 'variety': {
      // When the backend sends multiple sorts, join their names.
      const dominant = shipment.varieties_dominant;
      if (Array.isArray(dominant) && dominant.length > 1) {
        return dominant.map((v) => v.name).join(', ');
      }
      return shipment.variety_name ?? '—';
    }
    case 'vehicle_responsible':
      return shipment.vehicle_responsible ?? '—';
    case 'vehicle_condition':
      return shipment.vehicle_condition ?? '—';
    case 'border_point':
      return shipment.border_point_name ?? '—';
    case 'weight_net':
      return shipment.weight_net != null ? Number(shipment.weight_net).toLocaleString() : '—';
    case 'weight_to_load_kg':
      return shipment.weight_to_load_kg != null ? Number(shipment.weight_to_load_kg).toLocaleString() : '—';
    case 'transit_days':
      return shipment.transit_days != null ? `${shipment.transit_days}d` : '—';
    case 'has_peregruz':
      return shipment.has_peregruz ? i18n.t('sheet.has_peregruz_yes') : '—';
    case 'has_sales_report':
      return shipment.has_sales_report ? '✓' : '❌';
    case 'has_doc_advance':
      return shipment.has_doc_advance ? '✓' : '❌';
    case 'is_gapy_satys':
      return shipment.is_gapy_satys
        ? i18n.t('sheet.gornushi.gapy_satys')
        : i18n.t('sheet.gornushi.adaty');
    case 'notes':
    case 'export_manager_note':
    case 'warehouse_note':
    case 'document_note':
    case 'vehicle_condition_note':
    case 'vehicle_live_status':
    case 'additional_notes_arap':
      return (shipment[fieldKey as keyof IShipmentSheetItem] as string) ?? '—';
    // The second rig shares these three cells — it has no Sheet row of its own.
    case 'truck_plate':
      return joinRig(shipment.truck_plate, shipment.truck_plate_2);
    case 'driver_name':
      return joinRig(shipment.driver_name, shipment.driver_2_name);
    case 'driver_phone':
      return joinRig(shipment.driver_phone, shipment.driver_2_phone);
    case 'customs_clearance_planned_day': {
      const day = shipment.customs_clearance_planned_day;
      if (!day) return '—';
      return i18n.t(`weekday.${day}`);
    }
    default:
      break;
  }

  // harvest_date: free text (single day, ranges, notes) — display verbatim.
  if (fieldKey === 'harvest_date') {
    return shipment.harvest_date || '—';
  }

  // Date-only fields (no time component) — format DD.MM.YYYY.
  const dateOnlyFields = ['sales_report_date'];
  if (dateOnlyFields.includes(fieldKey)) {
    const val = shipment[fieldKey as keyof IShipmentSheetItem] as string | null;
    if (!val) return '—';
    return dayjs(val).format('DD.MM.YYYY');
  }

  // R4 — Şirin's "transport docs given" timestamp. Distinct from generic
  // datetime fields below because the empty state has a semantic label
  // ("Berilmedi" = not given) instead of the generic em-dash. Filling the
  // datepicker implies "Berildi at this time".
  if (fieldKey === 'transport_docs_given_at') {
    const val = shipment.transport_docs_given_at;
    if (!val) return i18n.t('sheet.transport_docs_berilmedi');
    return dayjs(val).format('DD.MM HH:mm');
  }

  // Timestamps (datetime, format DD.MM HH:mm).
  const tsFields = [
    'loading_started_at', 'loading_ended_at',
    'customs_entry_at', 'customs_exit_at', 'departed_at',
    'border_crossed_at', 'dest_entry_at',
    'arrived_at', 'sale_started_at', 'sale_ended_at',
    'peregruz_date',
  ];
  if (tsFields.includes(fieldKey)) {
    const val = shipment[fieldKey as keyof IShipmentSheetItem] as string | null;
    if (!val) return '—';
    return dayjs(val).format('DD.MM HH:mm');
  }

  // Firm splits
  if (fieldKey === 'firm_splits') {
    if (!shipment.firm_splits.length) return '—';
    return shipment.firm_splits.map((f) => f.firm_code).join('-');
  }

  // Firm contracts — synthetic cell (popover only), no copyable text value.
  if (fieldKey === 'firm_contracts') {
    return '';
  }

  // Block sources
  if (fieldKey === 'block_sources') {
    if (!shipment.block_sources.length) return '—';
    return shipment.block_sources.map((b) => b.block_code).join('/');
  }

  // Status fields — resolve option code → Turkmen label (label_tk).
  // Statuses are Turkmen-only by product decision; the UI locale is ignored.
  if (fieldKey === 'documents_status' || fieldKey === 'harvest_status') {
    const val = shipment[fieldKey as keyof IShipmentSheetItem] as string | null;
    if (!val) return '—';
    const match = options?.find((o) => o.category === fieldKey && o.code === val);
    return match?.label_tk ?? val;
  }
  if (fieldKey === 'transit_days_temp') {
    const days = shipment.transit_days;
    const temp = shipment.transport_temp_c;
    if (days == null && temp == null) return '—';
    return `${days ?? '?'}d ${temp ?? '?'}°C`;
  }
  return '—';
}

/**
 * Joins a first/second rig pair for display. Blank halves drop out with their
 * separator, so a truck with one driver reads "Ahmet A.", never "Ahmet A., ".
 * Mirrors the backend's `_join_rig` in document_context.py — the Sheet and the
 * CMR must not disagree about how a two-driver truck is written.
 */
function joinRig(first: string | null, second: string | null): string {
  const parts = [first, second].map((v) => (v ?? '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}
