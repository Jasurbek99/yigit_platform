import dayjs from 'dayjs';
import i18n from '@/i18n';
import type { IShipmentSheetItem, IRowConfig } from '@/types';

/**
 * Returns the canonical display string for a shipment cell.
 *
 * This is the single source of truth for converting raw IShipmentSheetItem
 * data into display text for a given row. Used by:
 *   - SheetCell.tsx  (the Sheet grid)
 *   - SelfBoardShipmentFieldList.tsx  (the task drawer field list)
 *
 * The function always returns a string — callers render "—" when it equals '—'.
 */
export function getCellValue(shipment: IShipmentSheetItem, rowConfig: IRowConfig): string {
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
    case 'cargo_code':
      return shipment.cargo_code;
    case 'official_export_code':
      return shipment.official_export_code ?? '—';
    case 'country':
      return shipment.country_name ?? '—';
    case 'customer':
      return shipment.customer_name ?? '—';
    case 'city':
      return shipment.city_name ?? '—';
    case 'import_firm':
      return shipment.import_firm_name ?? '—';
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
    case 'rejected_weight_kg':
      return shipment.rejected_weight_kg != null ? Number(shipment.rejected_weight_kg).toLocaleString() : '—';
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
    case 'truck_plate':
    case 'driver_name':
    case 'driver_phone':
    case 'additional_notes_arap':
      return (shipment[fieldKey as keyof IShipmentSheetItem] as string) ?? '—';
    case 'customs_clearance_planned_day': {
      const day = shipment.customs_clearance_planned_day;
      if (!day) return '—';
      return i18n.t(`weekday.${day}`);
    }
    default:
      break;
  }

  // harvest_date: read from block_sources (per-block primary) and render as a
  // min-max range. Falls back to shipment.harvest_date when no per-block dates
  // are set. See ShipmentBlockSource.harvest_date.
  if (fieldKey === 'harvest_date') {
    const blockDates = (shipment.block_sources ?? [])
      .map((b) => b.harvest_date)
      .filter((d): d is string => !!d)
      .sort();
    if (blockDates.length > 0) {
      const first = dayjs(blockDates[0]).format('DD.MM.YYYY');
      const last = dayjs(blockDates[blockDates.length - 1]).format('DD.MM.YYYY');
      return first === last ? first : `${first}–${last}`;
    }
    if (shipment.harvest_date) return dayjs(shipment.harvest_date).format('DD.MM.YYYY');
    return '—';
  }

  // Date-only fields (no time component) — format DD.MM.YYYY.
  const dateOnlyFields = ['sales_report_date'];
  if (dateOnlyFields.includes(fieldKey)) {
    const val = shipment[fieldKey as keyof IShipmentSheetItem] as string | null;
    if (!val) return '—';
    return dayjs(val).format('DD.MM.YYYY');
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

  // Block sources
  if (fieldKey === 'block_sources') {
    if (!shipment.block_sources.length) return '—';
    return shipment.block_sources.map((b) => b.block_code).join('/');
  }

  // Status fields — show stored value or dash
  if (fieldKey === 'documents_status' || fieldKey === 'harvest_status') {
    const val = shipment[fieldKey as keyof IShipmentSheetItem] as string | null;
    return val ?? '—';
  }
  if (fieldKey === 'transit_days_temp') {
    const days = shipment.transit_days;
    const temp = shipment.transport_temp_c;
    if (days == null && temp == null) return '—';
    return `${days ?? '?'}d ${temp ?? '?'}°C`;
  }

  return '—';
}
