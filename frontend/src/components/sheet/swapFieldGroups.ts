/**
 * Swappable field whitelist and group definitions for SwapFieldsModal.
 *
 * The whitelist is the source of truth for which fields the frontend offers
 * to the user. The backend enforces its own whitelist and will reject any
 * field not permitted server-side — so frontend-only additions cause a clean
 * 400 error, not a silent mutation.
 *
 * On modal mount, SwapFieldsModal fetches /api/v1/export/shipments/swappable-fields/
 * and console.warns if the sets differ (so a dev notices when backend adds/
 * removes a field without updating this file).
 */

/** Complete set of field_keys the UI offers for swapping. */
export const SWAPPABLE_FIELD_KEYS = new Set<string>([
  // Soltanmyrat
  'official_export_code',
  'harvest_status',
  'warehouse_note',
  'loading_started_at',
  'loading_ended_at',
  'rejected_weight_kg',
  'variety',
  'harvest_date',
  // Transport
  'vehicle_condition',
  'vehicle_condition_note',
  'vehicle_live_status',
  'vehicle_responsible',
  'truck_plate',
  'driver_name',
  'driver_phone',
  'transport_temp_c',
  // Gadam
  'export_manager_note',
  'country',
  'customer',
  'city',
  'import_firm',
  // Şirin
  'documents_status',
  'document_note',
  'customs_exit_at',
  'customs_clearance_planned_day',
  'transport_docs_given_at', // R4 (replaced Malik's notes per feedback #9)
  // Arap
  'border_point',
  'border_crossed_at',
  'dest_entry_at',
  'customs_entry_at',
  'has_peregruz',
  'peregruz_date',
  'peregruz_city',
  'arrived_at',
  'sale_started_at',
  'sale_ended_at',
  'sales_report_date',
  'additional_notes_arap',
  // General
  // NOTE: legacy Malik R4 'notes' removed from Sheet (replaced by
  // transport_docs_given_at). Field still exists on the model for legacy
  // data; not surfaced on the Sheet anymore.
  'departed_at',
  'transit_days',
  // Weight
  'weight_gross',
  'packaging_kg',
  'pallet_count',
  'box_count',
]);

/**
 * Group identifiers for the modal's Collapse panels.
 * Used as keys in GROUP_CONFIGS and as panel keys in the Ant Design Collapse.
 */
export type SwapFieldGroupId =
  | 'soltanmyrat'
  | 'transport'
  | 'gadam'
  | 'sirin'
  | 'arap'
  | 'other';

export interface ISwapFieldGroup {
  id: SwapFieldGroupId;
  /** i18n key for the group title */
  titleKey: string;
  /** Field keys assigned to this group (subset of SWAPPABLE_FIELD_KEYS) */
  fieldKeys: string[];
  /** Whether the Collapse panel is expanded by default */
  defaultExpanded: boolean;
}

/**
 * Bucketing rules. A field_key is assigned to the FIRST group whose
 * `fieldKeys` list contains it. The "other" group acts as a catch-all.
 *
 * Note: fieldKeys here are static. The modal filters them against
 * SWAPPABLE_FIELD_KEYS to guarantee consistency.
 */
export const GROUP_CONFIGS: ISwapFieldGroup[] = [
  {
    id: 'soltanmyrat',
    titleKey: 'sheet.swap_modal.group_soltanmyrat',
    defaultExpanded: true,
    fieldKeys: [
      'official_export_code',
      'harvest_status',
      'warehouse_note',
      'loading_started_at',
      'loading_ended_at',
      'rejected_weight_kg',
      'variety',
      'harvest_date',
      // Weight fields also shown under Soltanmyrat
      'weight_gross',
      'packaging_kg',
      'pallet_count',
      'box_count',
    ],
  },
  {
    id: 'transport',
    titleKey: 'sheet.swap_modal.group_transport',
    defaultExpanded: true,
    fieldKeys: [
      'vehicle_condition',
      'vehicle_condition_note',
      'vehicle_live_status',
      'vehicle_responsible',
      'truck_plate',
      'driver_name',
      'driver_phone',
      'transport_temp_c',
      'transit_days',
      'departed_at',
    ],
  },
  {
    id: 'gadam',
    titleKey: 'sheet.swap_modal.group_gadam',
    defaultExpanded: false,
    fieldKeys: [
      'export_manager_note',
      'country',
      'customer',
      'city',
      'import_firm',
    ],
  },
  {
    id: 'sirin',
    titleKey: 'sheet.swap_modal.group_sirin',
    defaultExpanded: false,
    fieldKeys: [
      'documents_status',
      'document_note',
      'customs_exit_at',
      'customs_clearance_planned_day',
      'transport_docs_given_at',
    ],
  },
  {
    id: 'arap',
    titleKey: 'sheet.swap_modal.group_arap',
    defaultExpanded: false,
    fieldKeys: [
      'border_point',
      'border_crossed_at',
      'dest_entry_at',
      'customs_entry_at',
      'has_peregruz',
      'peregruz_date',
      'peregruz_city',
      'arrived_at',
      'sale_started_at',
      'sale_ended_at',
      'sales_report_date',
      'additional_notes_arap',
    ],
  },
];

/**
 * Assigns each field_key in SWAPPABLE_FIELD_KEYS to a group.
 * Returns a list of groups with their resolved field keys (only those
 * that exist in SWAPPABLE_FIELD_KEYS), plus an "other" group for
 * anything not matched by a named group.
 */
export function buildGroupedFields(): ISwapFieldGroup[] {
  const assigned = new Set<string>();
  const named: ISwapFieldGroup[] = GROUP_CONFIGS.map((g) => {
    const resolved = g.fieldKeys.filter((fk) => SWAPPABLE_FIELD_KEYS.has(fk));
    for (const fk of resolved) assigned.add(fk);
    return { ...g, fieldKeys: resolved };
  });

  const other: string[] = [];
  for (const fk of SWAPPABLE_FIELD_KEYS) {
    if (!assigned.has(fk)) other.push(fk);
  }

  if (other.length > 0) {
    named.push({
      id: 'other',
      titleKey: 'sheet.swap_modal.group_other',
      defaultExpanded: false,
      fieldKeys: other,
    });
  }

  return named.filter((g) => g.fieldKeys.length > 0);
}
