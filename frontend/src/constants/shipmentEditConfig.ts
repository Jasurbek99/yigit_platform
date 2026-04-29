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
  | 'customsClearance'
  | 'documentsStatus'
  | 'harvestStatus';

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

export const EDIT_FIELD_GROUPS: IEditFieldGroup[] = [
  {
    key: 'logistics',
    titleKey: 'shipment_edit_drawer.section_logistics',
    fields: [
      { key: 'country', labelKey: 'shipment_edit_drawer.field.country', inputType: 'select', optionsSource: 'countries' },
      { key: 'customer', labelKey: 'shipment_edit_drawer.field.customer', inputType: 'select', optionsSource: 'customers' },
      { key: 'city', labelKey: 'shipment_edit_drawer.field.city', inputType: 'select', optionsSource: 'cities', countryFiltered: true },
      { key: 'import_firm', labelKey: 'shipment_edit_drawer.field.import_firm', inputType: 'select', optionsSource: 'importFirms' },
      { key: 'border_point', labelKey: 'shipment_edit_drawer.field.border_point', inputType: 'select', optionsSource: 'borderPoints' },
      { key: 'route_note', labelKey: 'shipment_edit_drawer.field.route_note', inputType: 'textarea' },
    ],
  },
  {
    key: 'transport',
    titleKey: 'shipment_edit_drawer.section_transport',
    fields: [
      { key: 'vehicle_responsible', labelKey: 'shipment_edit_drawer.field.vehicle_responsible', inputType: 'option_select', optionsSource: 'transportUsers' },
      { key: 'vehicle_condition', labelKey: 'shipment_edit_drawer.field.vehicle_condition', inputType: 'option_select', optionsSource: 'vehicleCondition' },
      { key: 'vehicle_condition_note', labelKey: 'shipment_edit_drawer.field.vehicle_condition_note', inputType: 'textarea' },
      { key: 'transit_days', labelKey: 'shipment_edit_drawer.field.transit_days', inputType: 'number', min: 0, suffix: 'd' },
      { key: 'transport_temp_c', labelKey: 'shipment_edit_drawer.field.transport_temp_c', inputType: 'number', suffix: '°C' },
    ],
  },
  {
    key: 'goods',
    titleKey: 'shipment_edit_drawer.section_goods',
    fields: [
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
      { key: 'is_gapy_satys', labelKey: 'shipment_edit_drawer.field.is_gapy_satys', inputType: 'boolean' },
    ],
  },
  {
    key: 'status',
    titleKey: 'shipment_edit_drawer.section_status',
    fields: [
      { key: 'customs_clearance', labelKey: 'shipment_edit_drawer.field.customs_clearance', inputType: 'option_select', optionsSource: 'customsClearance' },
      { key: 'documents_status', labelKey: 'shipment_edit_drawer.field.documents_status', inputType: 'option_select', optionsSource: 'documentsStatus' },
      { key: 'harvest_status', labelKey: 'shipment_edit_drawer.field.harvest_status', inputType: 'option_select', optionsSource: 'harvestStatus' },
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
  customs_clearance: 'customs_clearance',
  documents_status: 'documents_status',
  harvest_status: 'harvest_status',
};
