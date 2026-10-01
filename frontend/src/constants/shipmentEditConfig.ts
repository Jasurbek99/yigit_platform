/**
 * Field configs for the Shipment Edit Drawer (web management view).
 *
 * Single source of truth: which fields belong to which group, what input
 * each one needs, and which options source feeds dropdowns. Mirrors
 * `_ALL_PATCHABLE_FIELDS` on the backend — every key here MUST be in
 * the backend's patchable set or the PATCH will silently no-op.
 *
 * AD-1 timestamps (departed_at, arrived_at, etc.) are intentionally
 * absent — those are written ONLY by `transition_to()` server-side.
 */

export type FieldInputType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'option_select'
  | 'boolean'
  /** Tri-state answer (null = not answered yet, false = explicit «No»). */
  | 'yes_no';

export type OptionsSource =
  | 'countries'
  | 'cities'
  | 'customers'
  | 'importFirms'
  | 'borderPoints'
  | 'varieties'
  | 'transportUsers'
  | 'vehicleCondition'
  | 'documentsStatus'
  | 'harvestStatus'
  | 'weekdays';

export interface IEditFieldConfig {
  key: string;
  /** i18n key for the label, namespaced under shipment_edit_drawer.field. */
  labelKey: string;
  inputType: FieldInputType;
  optionsSource?: OptionsSource;
  /** When true, depends on `country` field — used by city. */
  countryFiltered?: boolean;
  /** Min/max for number inputs. */
  min?: number;
  /** Suffix shown next to a number input (kg, pcs, $). */
  suffix?: string;
}

export interface IEditFieldGroup {
  key: 'logistics' | 'transport' | 'goods' | 'finance' | 'status' | 'notes';
  /** i18n key for the section title. */
  titleKey: string;
  fields: IEditFieldConfig[];
}

/**
 * `harvest_status` lives in the `goods` group (Goods & Loading card renders
 * it standalone, ahead of the variety block — see ShipmentGoodsBody). It
 * used to sit in `status` (Documents & Customs); moved per product owner
 * so harvest status reads alongside the other loading-stage fields. Exported
 * so ShipmentGoodsBody can render it outside the group's normal field order
 * without duplicating the config object.
 */
export const HARVEST_STATUS_FIELD: IEditFieldConfig = {
  key: 'harvest_status',
  labelKey: 'shipment_edit_drawer.field.harvest_status',
  inputType: 'option_select',
  optionsSource: 'harvestStatus',
};

/**
 * `truck_plate` stays in the `transport` group's field list (so the card's
 * completeness chip keeps counting it), but non-Gapy-Satys shipments render
 * `ShipmentTruckSelector` (fleet head/trailer dropdowns) in its place instead
 * of this plain-text row — see ShipmentTransportBody. Exported so that
 * standalone render can reference the same config object as the group.
 */
export const TRUCK_PLATE_FIELD: IEditFieldConfig = {
  key: 'truck_plate',
  labelKey: 'shipment_edit_drawer.field.truck_plate',
  inputType: 'text',
};

/**
 * Same pull-one-field-out arrangement as TRUCK_PLATE_FIELD, one row down:
 * non-Gapy-Satys shipments pick the driver from the Z_TIRWEB registry via
 * ShipmentDriverSelector (which writes driver_id alongside the name), Gapy ones
 * keep this plain-text row. Exported so both renderers reference one config.
 */
export const DRIVER_NAME_FIELD: IEditFieldConfig = {
  key: 'driver_name',
  labelKey: 'shipment_edit_drawer.field.driver_name',
  inputType: 'text',
};

export const EDIT_FIELD_GROUPS: IEditFieldGroup[] = [
  {
    key: 'logistics',
    titleKey: 'shipment_edit_drawer.section_logistics',
    fields: [
      { key: 'country', labelKey: 'shipment_edit_drawer.field.country', inputType: 'select', optionsSource: 'countries' },
      { key: 'customer', labelKey: 'shipment_edit_drawer.field.customer', inputType: 'select', optionsSource: 'customers' },
      { key: 'city', labelKey: 'shipment_edit_drawer.field.city', inputType: 'select', optionsSource: 'cities', countryFiltered: true },
      { key: 'import_firm', labelKey: 'shipment_edit_drawer.field.import_firm', inputType: 'select', optionsSource: 'importFirms' },
      { key: 'is_gapy_satys', labelKey: 'shipment_edit_drawer.field.is_gapy_satys', inputType: 'boolean' },
    ],
  },
  {
    key: 'transport',
    titleKey: 'shipment_edit_drawer.section_transport',
    fields: [
      TRUCK_PLATE_FIELD,
      DRIVER_NAME_FIELD,
      { key: 'driver_phone', labelKey: 'shipment_edit_drawer.field.driver_phone', inputType: 'text' },
      { key: 'vehicle_responsible', labelKey: 'shipment_edit_drawer.field.vehicle_responsible', inputType: 'option_select', optionsSource: 'transportUsers' },
      { key: 'vehicle_condition', labelKey: 'shipment_edit_drawer.field.vehicle_condition', inputType: 'option_select', optionsSource: 'vehicleCondition' },
      { key: 'vehicle_condition_note', labelKey: 'shipment_edit_drawer.field.vehicle_condition_note', inputType: 'textarea' },
      { key: 'transit_days', labelKey: 'shipment_edit_drawer.field.transit_days', inputType: 'number', min: 0, suffix: 'd' },
      { key: 'transport_temp_c', labelKey: 'shipment_edit_drawer.field.transport_temp_c', inputType: 'number', suffix: '°C' },
      { key: 'border_point', labelKey: 'shipment_edit_drawer.field.border_point', inputType: 'select', optionsSource: 'borderPoints' },
    ],
  },
  {
    key: 'goods',
    titleKey: 'shipment_edit_drawer.section_goods',
    fields: [
      HARVEST_STATUS_FIELD,
      { key: 'variety', labelKey: 'shipment_edit_drawer.field.variety', inputType: 'select', optionsSource: 'varieties' },
      { key: 'weight_net', labelKey: 'shipment_edit_drawer.field.weight_net', inputType: 'number', min: 0, suffix: 'kg' },
      { key: 'weight_gross', labelKey: 'shipment_edit_drawer.field.weight_gross', inputType: 'number', min: 0, suffix: 'kg' },
      { key: 'packaging_kg', labelKey: 'shipment_edit_drawer.field.packaging_kg', inputType: 'number', min: 0, suffix: 'kg' },
      { key: 'weight_to_load_kg', labelKey: 'shipment_edit_drawer.field.weight_to_load_kg', inputType: 'number', min: 0, suffix: 'kg' },
      { key: 'pallet_count', labelKey: 'shipment_edit_drawer.field.pallet_count', inputType: 'number', min: 0 },
      { key: 'box_count', labelKey: 'shipment_edit_drawer.field.box_count', inputType: 'number', min: 0 },
    ],
  },
  {
    key: 'finance',
    titleKey: 'shipment_edit_drawer.section_finance',
    fields: [
      { key: 'price_per_kg', labelKey: 'shipment_edit_drawer.field.price_per_kg', inputType: 'number', min: 0, suffix: '$' },
      { key: 'total_amount_usd', labelKey: 'shipment_edit_drawer.field.total_amount_usd', inputType: 'number', min: 0, suffix: '$' },
    ],
  },
  {
    key: 'status',
    titleKey: 'shipment_edit_drawer.section_status',
    fields: [
      { key: 'documents_status', labelKey: 'shipment_edit_drawer.field.documents_status', inputType: 'option_select', optionsSource: 'documentsStatus' },
      { key: 'customs_clearance_planned_day', labelKey: 'shipment_edit_drawer.field.customs_clearance_planned_day', inputType: 'select', optionsSource: 'weekdays' },
    ],
  },
  {
    key: 'notes',
    titleKey: 'shipment_edit_drawer.section_notes',
    fields: [
      { key: 'notes', labelKey: 'shipment_edit_drawer.field.notes', inputType: 'textarea' },
    ],
  },
];

/**
 * Detail-page rows beyond EDIT_FIELD_GROUPS (spec
 * 2026-09-30-shipment-detail-full-design.md). Kept out of EDIT_FIELD_GROUPS so
 * ShipmentEditDrawer does not change. Keyed by the group whose card renders
 * them; labels reuse the Sheet row's label key so both screens read the same.
 */
export const DETAIL_EXTRA_FIELDS: Record<IEditFieldGroup['key'], IEditFieldConfig[]> = {
  logistics: [],
  transport: [
    { key: 'vehicle_live_status', labelKey: 'sheet.row.vehicle_live_status', inputType: 'text' },
    { key: 'transport_docs_given_at', labelKey: 'sheet.row.transport_docs_given', inputType: 'datetime' },
    { key: 'shelf_life_days', labelKey: 'shipment_edit_drawer.field.shelf_life_days', inputType: 'number', min: 0, suffix: 'd' },
    { key: 'truck_plate_2', labelKey: 'shipment_detail.parts.truck_plate_2', inputType: 'text' },
    { key: 'driver_2_name', labelKey: 'shipment_detail.parts.driver_2_name', inputType: 'text' },
    { key: 'driver_2_phone', labelKey: 'shipment_detail.parts.driver_2_phone', inputType: 'text' },
    { key: 'greenhouse_arrived_at', labelKey: 'sheet.row.greenhouse_arrival', inputType: 'datetime' },
    { key: 'departed_at', labelKey: 'sheet.row.greenhouse_departure', inputType: 'datetime' },
    { key: 'border_crossed_at', labelKey: 'sheet.row.border_exit', inputType: 'datetime' },
    { key: 'dest_entry_at', labelKey: 'sheet.row.dest_entry', inputType: 'datetime' },
    { key: 'has_peregruz', labelKey: 'sheet.row.peregruz_status', inputType: 'yes_no' },
    { key: 'peregruz_date', labelKey: 'sheet.row.peregruz_time', inputType: 'datetime' },
    { key: 'peregruz_city', labelKey: 'shipments.peregruz_city', inputType: 'text' },
    { key: 'arrived_at', labelKey: 'sheet.row.arrival', inputType: 'datetime' },
  ],
  goods: [
    { key: 'loading_started_at', labelKey: 'sheet.row.loading_start', inputType: 'datetime' },
    { key: 'loading_ended_at', labelKey: 'sheet.row.loading_end', inputType: 'datetime' },
  ],
  finance: [
    { key: 'sale_started_at', labelKey: 'sheet.row.sale_start', inputType: 'datetime' },
    { key: 'sale_ended_at', labelKey: 'sheet.row.sale_end', inputType: 'datetime' },
    { key: 'sales_report_date', labelKey: 'sheet.row.report_date', inputType: 'date' },
  ],
  status: [
    { key: 'document_note', labelKey: 'sheet.row.document_notes', inputType: 'textarea' },
    { key: 'customs_exit_at', labelKey: 'sheet.row.customs_exit_tm', inputType: 'datetime' },
    { key: 'customs_entry_at', labelKey: 'sheet.row.dest_customs', inputType: 'datetime' },
  ],
  notes: [
    { key: 'export_manager_note', labelKey: 'sheet.row.export_manager_note', inputType: 'textarea' },
    { key: 'warehouse_note', labelKey: 'sheet.row.warehouse_notes', inputType: 'textarea' },
    { key: 'additional_notes_arap', labelKey: 'sheet.row.additional_notes_arap', inputType: 'textarea' },
  ],
};

/** Second-rig rows: read-only while a Planning trip owns the transport fields. */
export const SECOND_RIG_KEYS: ReadonlySet<string> = new Set(['truck_plate_2', 'driver_2_name', 'driver_2_phone']);

/** ShipmentOptionType category code per option_select field. */
export const OPTION_CATEGORY_BY_FIELD: Record<string, string> = {
  vehicle_responsible: 'transport_responsible',
  vehicle_condition: 'vehicle_condition',
  documents_status: 'documents_status',
  harvest_status: 'harvest_status',
};
