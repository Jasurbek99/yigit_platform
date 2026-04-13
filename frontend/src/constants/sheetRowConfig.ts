import type { IRowConfig } from '@/types';

/**
 * Row configuration for the shipment spreadsheet view.
 * Maps each row (2-45) to its field, input type, style, and permissions.
 * Based on P3_Shipment_Sheet_Spec.md.
 */
export const SHEET_ROW_CONFIG: IRowConfig[] = [
  // === Frozen Section (Rows 2-14) — Shipment Identity & Planning ===
  { rowNumber: 2, fieldKey: 'route_note', whoKey: 'sheet.who.logist', labelKey: 'sheet.row.transport_note', inputType: 'text', style: 'base' },
  { rowNumber: 3, fieldKey: 'vehicle_condition', whoKey: 'sheet.who.logist', labelKey: 'sheet.row.truck_status', inputType: 'dropdown', style: 'transport', optionsSource: 'vehicleCondition' },
  { rowNumber: 4, fieldKey: 'notes', whoKey: 'sheet.who.malik', labelKey: 'sheet.row.additional_notes', inputType: 'text', style: 'base' },
  { rowNumber: 5, fieldKey: 'customs_clearance', whoKey: 'sheet.who.gadam', labelKey: 'sheet.row.customs_clearance', inputType: 'status', style: 'status' },
  { rowNumber: 6, fieldKey: 'documents_status', whoKey: 'sheet.who.sirin', labelKey: 'sheet.row.documents', inputType: 'status', style: 'status' },
  { rowNumber: 7, fieldKey: 'cargo_code', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.shipment_code', inputType: 'readonly', style: 'key' },
  { rowNumber: 8, fieldKey: 'block_sources', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.harvest_block', inputType: 'multiselect', style: 'base', optionsSource: 'blocks' },
  { rowNumber: 9, fieldKey: 'firm_splits', whoKey: 'sheet.who.sulgun', labelKey: 'sheet.row.export_firm', inputType: 'multiselect', style: 'base', optionsSource: 'exportFirms' },
  { rowNumber: 10, fieldKey: 'country', whoKey: 'sheet.who.gadam', labelKey: 'sheet.row.country', inputType: 'dropdown', style: 'key', optionsSource: 'countries' },
  { rowNumber: 11, fieldKey: 'customer', whoKey: 'sheet.who.gadam', labelKey: 'sheet.row.customer', inputType: 'dropdown', style: 'base', optionsSource: 'customers' },
  { rowNumber: 12, fieldKey: 'city', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.city', inputType: 'dropdown', style: 'base', optionsSource: 'cities' },
  { rowNumber: 13, fieldKey: 'import_firm', whoKey: 'sheet.who.gadam', labelKey: 'sheet.row.import_firm', inputType: 'dropdown', style: 'base', optionsSource: 'importFirms' },
  { rowNumber: 14, fieldKey: 'harvest_status', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.harvest_status', inputType: 'status', style: 'status' },

  // === Scrollable Section (Rows 15-45) — Operations & Logistics ===
  { rowNumber: 15, fieldKey: 'truck_capacity', whoKey: 'sheet.who.haltac', labelKey: 'sheet.row.truck_capacity', inputType: 'text', style: 'transport' },
  { rowNumber: 16, fieldKey: 'product_date', whoKey: 'sheet.who.none', labelKey: 'sheet.row.product_date', inputType: 'text', style: 'base' },
  { rowNumber: 20, fieldKey: 'loading_started_at', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.loading_start', inputType: 'datetime', style: 'base' },
  { rowNumber: 21, fieldKey: 'loading_ended_at', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.loading_end', inputType: 'datetime', style: 'base' },
  { rowNumber: 22, fieldKey: 'departed_at', whoKey: 'sheet.who.mergen', labelKey: 'sheet.row.greenhouse_departure', inputType: 'datetime', style: 'base' },
  { rowNumber: 23, fieldKey: 'vehicle_responsible', whoKey: 'sheet.who.transport', labelKey: 'sheet.row.vehicle_responsible', inputType: 'dropdown', style: 'transport', optionsSource: 'transportUsers' },
  { rowNumber: 24, fieldKey: 'truck_plate', whoKey: 'sheet.who.transport', labelKey: 'sheet.row.truck_plate', inputType: 'text', style: 'transport' },
  { rowNumber: 26, fieldKey: 'customs_exit_at', whoKey: 'sheet.who.sirin', labelKey: 'sheet.row.customs_exit', inputType: 'datetime', style: 'key' },
  { rowNumber: 27, fieldKey: 'transit_days_temp', whoKey: 'sheet.who.quality', labelKey: 'sheet.row.transit_temp', inputType: 'text', style: 'base' },
  { rowNumber: 28, fieldKey: 'driver_name', whoKey: 'sheet.who.transport', labelKey: 'sheet.row.driver_name', inputType: 'text', style: 'transport' },
  { rowNumber: 29, fieldKey: 'driver_phone', whoKey: 'sheet.who.transport', labelKey: 'sheet.row.driver_phone', inputType: 'phone', style: 'transport' },
  { rowNumber: 30, fieldKey: 'border_point', whoKey: 'sheet.who.transport', labelKey: 'sheet.row.border_point', inputType: 'dropdown', style: 'base', optionsSource: 'borderPoints', gapyHidden: true },
  { rowNumber: 31, fieldKey: 'border_crossed_at', whoKey: 'sheet.who.haltac', labelKey: 'sheet.row.border_exit', inputType: 'datetime', style: 'base', gapyHidden: true },
  { rowNumber: 32, fieldKey: 'dest_entry_at', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.dest_entry', inputType: 'datetime', style: 'base', gapyHidden: true },
  { rowNumber: 33, fieldKey: 'customs_entry_at', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.dest_customs', inputType: 'datetime', style: 'base', gapyHidden: true },
  { rowNumber: 34, fieldKey: 'has_peregruz', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.peregruz_status', inputType: 'dropdown', style: 'base', optionsSource: 'peregruz' },
  { rowNumber: 35, fieldKey: 'peregruz_date', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.peregruz_time', inputType: 'datetime', style: 'base' },
  { rowNumber: 36, fieldKey: 'arrived_at', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.arrival', inputType: 'datetime', style: 'base' },
  { rowNumber: 37, fieldKey: 'rejected_weight_kg', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.weight_received', inputType: 'number', style: 'base' },
  { rowNumber: 38, fieldKey: 'weight_net', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.weight_shipped', inputType: 'number', style: 'key' },
  { rowNumber: 39, fieldKey: 'variety', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.variety', inputType: 'dropdown', style: 'base', optionsSource: 'varieties' },
  { rowNumber: 40, fieldKey: 'harvest_date', whoKey: 'sheet.who.soltanmyrat', labelKey: 'sheet.row.harvest_date', inputType: 'date', style: 'base' },
  { rowNumber: 41, fieldKey: 'cmr_status', whoKey: 'sheet.who.none', labelKey: 'sheet.row.cmr_status', inputType: 'readonly', style: 'separator' },
  { rowNumber: 42, fieldKey: 'sale_started_at', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.sale_start', inputType: 'date', style: 'report' },
  { rowNumber: 43, fieldKey: 'sale_ended_at', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.sale_end', inputType: 'date', style: 'report' },
  { rowNumber: 44, fieldKey: 'has_sales_report', whoKey: 'sheet.who.aganazar', labelKey: 'sheet.row.report_date', inputType: 'date', style: 'report' },
  { rowNumber: 45, fieldKey: 'additional_notes_arap', whoKey: 'sheet.who.arap', labelKey: 'sheet.row.additional_notes_arap', inputType: 'text', style: 'base' },
];

/** Rows in the frozen top section (identity & planning) */
export const FROZEN_ROWS = SHEET_ROW_CONFIG.filter((r) => r.rowNumber <= 14);

/** Rows in the scrollable bottom section (operations & logistics) */
export const SCROLLABLE_ROWS = SHEET_ROW_CONFIG.filter((r) => r.rowNumber > 14);

/** Column widths (px) */
export const COL_WIDTH_ROW_NUM = 28;
export const COL_WIDTH_WHO = 120;
export const COL_WIDTH_FIELD = 210;
export const COL_WIDTH_SHIPMENT = 145;
export const FROZEN_LEFT_TOTAL = COL_WIDTH_ROW_NUM + COL_WIDTH_WHO + COL_WIDTH_FIELD; // 358px

/** Row height (px) */
export const ROW_HEIGHT = 36;

/** Vehicle condition options */
export const VEHICLE_CONDITION_OPTIONS = [
  { value: 'OK', label: 'OK' },
  { value: 'ISSUE', label: 'Issue' },
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'RETURNED', label: 'Returned' },
];
