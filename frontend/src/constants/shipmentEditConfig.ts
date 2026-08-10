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
  | 'boolean';

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
      { key: 'driver_name', labelKey: 'shipment_edit_drawer.field.driver_name', inputType: 'text' },
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
      { key: 'rejected_weight_kg', labelKey: 'shipment_edit_drawer.field.rejected_weight_kg', inputType: 'number', min: 0, suffix: 'kg' },
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

/** ShipmentOptionType category code per option_select field. */
export const OPTION_CATEGORY_BY_FIELD: Record<string, string> = {
  vehicle_responsible: 'transport_responsible',
  vehicle_condition: 'vehicle_condition',
  documents_status: 'documents_status',
  harvest_status: 'harvest_status',
};
