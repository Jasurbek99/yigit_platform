// â”€â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// --- Phase (Stream C) -------------------------------------------------------

export type ShipmentPhase = 'PLAN' | 'PREP' | 'DOCS' | 'LOAD' | 'TRANSIT' | 'DEST' | 'CLOSE' | 'CANCELLED';

// --- Auth -------------------------------------------------------------------

export type UserRole =
  | 'admin'
  | 'export_manager'
  | 'loading_dept_head'
  | 'loading_dept_head_deputy'
  | 'warehouse_chief'
  | 'weight_master'
  | 'document_team'
  | 'transport'
  | 'sales_rep'
  | 'finansist'
  | 'director'
  | 'accountant'
  | 'greenhouse_manager'
  | 'seller'
  | 'boss';

export interface IResourcePermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface ICurrentUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  is_superuser: boolean;
  managed_block_ids: number[];
  permissions: string[];  // Django permission codenames; ['*'] for superuser
  page_permissions: Record<string, boolean>;
  resource_permissions: Record<string, IResourcePermission>;
  field_permissions: Record<string, string[]>;
  /** The write-target season, or null during the legitimate close→open gap. */
  active_season: { id: number; name: string; status: SeasonStatus } | null;
  /** Whether this user may select a closed season in the switcher. */
  can_view_closed_seasons: boolean;
}

// â”€â”€â”€ Reference â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ICountry {
  id: number;
  name_tk: string;
  name_ru: string | null;
  name_en: string | null;
  code: string | null;
  /** Local sale currency for this destination (KZ→KZT, RU→RUB). Null when unset. */
  currency?: string | null;
  /** Sheet cell color (hex like "#fde68a") — paints cells whose country = this row. */
  color?: string | null;
  sort_order?: number;
}

export interface ICity {
  id: number;
  name: string;
  name_local: string | null;
  country: number;
  color?: string | null;
  sort_order?: number;
}

export interface IExportFirm {
  id: number;
  code: string;
  name_short: string | null;
  name_tk: string;
  name_ru: string | null;
  name_en: string | null;
  address_tk: string | null;
  address_en: string | null;
  address_ru: string | null;
  bank_details_tk: string | null;
  bank_details_en: string | null;
  bank_details_ru: string | null;
  director: string | null;
  director_tk: string | null;
  tax_code: string | null;
  swift_code: string | null;
  one_c_code: string | null;
  color?: string | null;
  sort_order?: number;
  is_active: boolean;
  is_gapy_satys: boolean;
  director_signature: string | null;
  director_seal: string | null;
}

export interface IImportFirm {
  id: number;
  code: string | null;
  name_company: string;
  name_short: string | null;
  country: number | null;
  country_name: string | null;
  city: number | null;
  city_name: string | null;
  address: string | null;
  bank_details: string | null;
  contact_person: string | null;
  contact_person_tk: string | null;
  phone: string | null;
  color?: string | null;
  sort_order?: number;
  is_active: boolean;
  is_gapy_satys: boolean;
  director_signature: string | null;
  director_seal: string | null;
}

export interface ICustomer {
  id: number;
  name: string;
  phone: string | null;
  default_country: number | null;
  country_name: string | null;
  default_city: number | null;
  city_name: string | null;
  import_firms: number[];
  import_firm_names: { id: number; name: string }[];
  sales_rep: number | null;
  sales_rep_name: string | null;
  color?: string | null;
  sort_order?: number;
  is_active: boolean;
}

export interface IShipmentStatusType {
  id: number;
  code: string;
  name_tk: string;
  name_en: string | null;
  name_ru: string | null;
  step_order: number;
  required_role: string | null;
  phase: string | null;
}

export interface IBorderPoint {
  id: number;
  name: string;
  route_description: string | null;
  typical_transit_days: number | null;
  color?: string | null;
  sort_order?: number;
  is_active: boolean;
}

export interface IShipmentOptionType {
  id: number;
  category: string;
  code: string;
  label_tk: string;
  label_en: string | null;
  label_ru: string | null;
  icon: string | null;
  /** Per-option cell background color (hex like "#fde68a") or null. */
  color?: string | null;
  sort_order: number;
  is_active: boolean;
}

// ─── Managed page permissions (ADR-022 delegated user management) ──────────────

export interface IManagedPagePermissions {
  /** Role codes the current user may manage (e.g. ['loading_dept_head_deputy', 'weight_master']). */
  roles: string[];
  /** Pages the manager is allowed to grant — already filtered server-side. */
  pages: { code: string; label: string }[];
  /** Current visibility per managed role per page. Missing key = false. */
  matrix: Record<string, Record<string, boolean>>;
}

// â”€â”€â”€ API helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IApiListResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface IApiError {
  error: string;
}

// â”€â”€â”€ Shipment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type VehicleCondition = 'OK' | 'ISSUE' | 'BREAKDOWN' | 'RETURNED';

export interface IShipmentListItem {
  id: number;
  shipment_code: string;
  date: string;             // ISO date
  status: number;           // FK id
  status_display: string;
  status_step: number;      // step_order from ShipmentStatusType (1-13)
  country_name: string | null;
  customer_name: string | null;
  weight_net: number | null;
  weight_gross: number | null;
  departed_at: string | null;   // ISO datetime
  arrived_at: string | null;
  is_gapy_satys: boolean;
  updated_at: string;
  // Fields for Kanban "My Tasks" missing-field detection
  city_name: string | null;
  variety_name: string | null;
  border_point_name: string | null;
  harvest_status: string | null;
  documents_status: string | null;
  truck_head_id: number | null;
  driver_id: number | null;
  price_per_kg: number | null;
  total_amount_usd: number | null;
  export_code: string | null;
  previous_platform_id: number | null;
  harvest_age_days: number;
  freshness: 'today' | 'yesterday' | 'aged';
  // Phase grouping (Stream C)
  phase: ShipmentPhase;
  // ─── Opt-in column fields (Sheet parity, scalar only) ──────────────────────
  // Returned by ShipmentListSerializer so the column manager can offer the same
  // operational fields the Sheet shows as rows. Hidden by default in the table.
  status_code: string;
  country_code: string | null;
  variety: number | null;
  variety_code: string | null;
  import_firm: number | null;
  import_firm_name: string | null;
  /** Comma-joined export firm codes from firm_splits (e.g. "YGT, HJ"). */
  export_firms_display: string | null;
  // Weight detail
  packaging_kg: number | null;
  pallet_count: number | null;
  box_count: number | null;
  rejected_weight_kg: number | null;
  // Transport
  vehicle_responsible: string | null;
  vehicle_responsible_display: string | null;
  trailer_id: number | null;
  truck_plate: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  transport_temp_c: number | null;
  transit_days: number | null;
  has_peregruz: boolean;
  peregruz_city: string | null;
  peregruz_date: string | null;
  // Operational planning
  customs_clearance_planned_day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | '' | null;
  // R4 — Şirin logs when transport dept handed over docs (null = Berilmedi)
  transport_docs_given_at: string | null;
  // AD-1 + operator-entered timestamps
  loading_started_at: string | null;
  customs_entry_at: string | null;
  customs_exit_at: string | null;
  border_crossed_at: string | null;
  sale_started_at: string | null;
  sale_ended_at: string | null;
  dest_entry_at: string | null;
  loading_ended_at: string | null;
  sales_report_date: string | null;
  harvest_date: string | null;
  // AD-2 vehicle condition + live status
  vehicle_condition: VehicleCondition | null;
  vehicle_condition_note: string | null;
  vehicle_live_status: string | null;
  // Quality doc flags (flattened)
  doc_azyk: boolean;
  doc_suriji: boolean;
  doc_hil: boolean;
  doc_kalibrowka: boolean;
  // Notes
  notes: string | null;
  export_manager_note: string | null;
  warehouse_note: string | null;
  document_note: string | null;
  additional_notes_arap: string | null;
  // Audit
  created_by_name: string | null;
  created_at: string;
  // Soft-delete metadata — null on operational rows; set on rows surfaced by
  // the admin ?show_deleted=true view.
  deleted_at: string | null;
  deleted_by_name: string | null;
}

// â”€â”€â”€ Sheet View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ISheetFirmSplit {
  firm_code: string;
  firm_name: string | null;
  /** Per-firm cell color (hex) — paints the firm chip in the firm_splits cell. */
  firm_color?: string | null;
  weight_kg: number;
  amount_usd: number | null;
}

export interface ISheetBlockSource {
  block_id?: number;
  block_code: string;
  /** Per-block cell color (hex) — paints the block chip in the block_sources cell. */
  block_color?: string | null;
  weight_kg: number | null;
  // Per-block harvest date (R39 source) — null when never set; falls back
  // to shipment.harvest_date for display.
  harvest_date?: string | null;
}

export interface IShipmentSheetItem {
  id: number;
  shipment_code: string;
  date: string;
  // Status
  status: number;
  status_display: string;
  status_code: string;
  status_step: number;
  // Phase grouping (Stream C)
  phase: ShipmentPhase;
  // Geography
  country: number | null;
  country_name: string | null;
  country_code: string | null;
  /** Admin-managed Sheet cell color for this country (hex or null). */
  country_color?: string | null;
  city: number | null;
  city_name: string | null;
  city_color?: string | null;
  border_point: number | null;
  border_point_name: string | null;
  border_point_color?: string | null;
  // Customer
  customer: number | null;
  customer_name: string | null;
  customer_color?: string | null;
  import_firm: number | null;
  import_firm_name: string | null;
  import_firm_color?: string | null;
  // Whole-truck packing template → CMR
  packing_template: number | null;
  packing_template_name: string | null;
  // Product
  variety: number | null;
  variety_name: string | null;
  variety_code: string | null;
  variety_color?: string | null;
  /** Full set of sorts on this shipment. First entry = dominant/primary. */
  varieties_dominant?: IVarietyInline[];
  // Weight
  weight_gross: number | null;
  weight_net: number | null;
  packaging_kg: number | null;
  pallet_count: number | null;
  box_count: number | null;
  rejected_weight_kg: number | null;
  // Transport
  vehicle_responsible: string | null;
  vehicle_responsible_display: string | null;
  truck_head_id: number | null;
  trailer_id: number | null;
  driver_id: number | null;
  // R23, R27, R28 — operator-entered transport details
  truck_plate: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  transport_temp_c: number | null;
  transit_days: number | null;
  has_peregruz: boolean;
  peregruz_city: string | null;
  peregruz_date: string | null;
  // Finance
  price_per_kg: number | null;
  total_amount_usd: number | null;
  is_gapy_satys: boolean;
  // Operational status
  documents_status: string | null;
  harvest_status: string | null;
  // AD-1 Timestamps
  loading_started_at: string | null;
  customs_entry_at: string | null;
  customs_exit_at: string | null;
  departed_at: string | null;
  border_crossed_at: string | null;
  arrived_at: string | null;
  sale_started_at: string | null;
  sale_ended_at: string | null;
  // R31 — operator-entered datetime, Arap logs destination-country entry
  dest_entry_at: string | null;
  // Operator-entered timestamp (NOT AD-1 â€” editable inline on R20)
  loading_ended_at: string | null;
  // Operator-entered date â€” editable inline on R43 (sales rep files report)
  sales_report_date: string | null;
  // Operator-entered date â€” editable inline on R39 (warehouse logs harvest day)
  harvest_date: string | null;
  // AD-2 Vehicle
  vehicle_condition: VehicleCondition | null;
  vehicle_condition_note: string | null;
  // R15 â€” dispatcher's live status / ETA note
  vehicle_live_status: string | null;
  // Quality docs
  doc_azyk: boolean;
  doc_suriji: boolean;
  doc_hil: boolean;
  doc_kalibrowka: boolean;
  // Annotations
  has_sales_report: boolean;
  has_doc_advance: boolean;
  // Notes
  notes: string | null;
  export_manager_note: string | null;
  warehouse_note: string | null;
  document_note: string | null;
  // R44 — Arap's destination-side freeform note
  additional_notes_arap: string | null;
  // Document team: planned weekday for customs clearance (e.g. 'mon', 'wed')
  customs_clearance_planned_day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | '' | null;
  // R4 — Şirin logs when transport dept handed over docs (null = Berilmedi)
  transport_docs_given_at: string | null;
  export_code: string | null;
  previous_platform_id: number | null;
  // Per-shipment tint applied to this column in the Sheet view.
  // Hex (#RRGGBB) when set, null = default theme. Edited by admin / export_manager.
  column_color: string | null;
  // Inline related
  firm_splits: ISheetFirmSplit[];
  block_sources: ISheetBlockSource[];
  // Audit
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Role of the user who created this shipment.
   * Used by the Sheet to tint supply-side columns (loading_dept_head / warehouse_chief).
   */
  created_by_role: string | null;
  /**
   * Phase 5c â€” admin-created custom row values.
   * Map of `field_key` (always starts with `custom_`) â†’ free-text value.
   * Empty object when this shipment has no custom values yet.
   */
  custom_fields?: Record<string, string>;
}

// â”€â”€â”€ Sheet API response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// comment_counts: { [shipment_id]: { [field_key]: count } }
// task_counts:    { [shipment_id]: { open: n, done: n, assigned_to_me_open: n } }
export interface ISheetCommentCounts {
  [shipmentId: number]: Record<string, number>;
}

export interface ISheetTaskCounts {
  [shipmentId: number]: {
    open: number;
    done: number;
    assigned_to_me_open: number;
  };
}

// â”€â”€â”€ User Sheet Preferences â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Mirrors the GET/PATCH /api/v1/export/user/sheet-preferences/ response shape.
 * Both arrays carry SheetRowSetting.id values (numeric PK), NOT field_keys.
 * ADR-0003: row_order only contains ids where user.position IS NOT NULL;
 * rows absent from row_order fall back to admin display_order.
 */
export interface IUserSheetPreferences {
  row_order: number[];       // SheetRowSetting.id values, in user's preferred order
  hidden_rows: number[];     // SheetRowSetting.id values the user has hidden
  updated_at: string | null; // ISO 8601 or null when no prefs set yet
}

/**
 * Per-cell background colors: shipment id -> field_key -> #RRGGBB.
 * The most specific of the four Sheet coloring layers; see SheetCell for the
 * full precedence (cell > per-value > row style > column tint).
 */
export type ISheetCellColors = Record<number, Record<string, string>>;

export interface IShipmentSheetResponse {
  results: IShipmentSheetItem[];
  comment_counts: ISheetCommentCounts;
  task_counts: ISheetTaskCounts;
  cell_colors: ISheetCellColors;
  /** Backend-driven row map â€” replaces the frontend SHEET_ROW_CONFIG constant. */
  rows: IRowConfig[];
  /** Per-row settings keyed by field_key (Sheet Control v2). */
  row_settings: Record<string, ISheetRowSettingForUser>;
  /** Sparse last-edit summaries: shipment_id (string) â†’ field_key â†’ edit info. */
  last_edits: Record<string, Record<string, ICellLastEdit>>;
  // Sheet Control v2 additions
  /** Compact user index: user_id (string) â†’ {name, role}. */
  users_index: Record<string, { name: string; role: string | null }>;
  current_user_id: number;
  current_user_lang: 'tk' | 'ru' | 'en';
  /**
   * Phase 2a: per-user row preferences emitted inline to avoid a second API call.
   * row_order contains only ids where user.position IS NOT NULL.
   * hidden_rows contains ids where user.is_hidden=True.
   * May be absent in older API versions â€” optional.
   */
  user_preferences?: { row_order: number[]; hidden_rows: number[] };
}

export type SheetRowStyle = 'base' | 'alt' | 'key' | 'transport' | 'status' | 'report' | 'separator';
export type SheetInputType = 'text' | 'number' | 'dropdown' | 'multiselect' | 'date' | 'datetime' | 'phone' | 'status' | 'readonly' | 'comment_count';

/** Row configuration â€” mirrors the backend `DEFAULT_SHEET_ROWS` shape (snake_case). */
export interface IRowConfig {
  row_number: number;
  field_key: string;
  /** i18n key for the "Who" column â€” used as fallback when no trigger is configured. */
  default_who_key: string;
  label_key: string;
  input_type: SheetInputType;
  style: SheetRowStyle;
  options_source?: string;
  gapy_hidden?: boolean;
  /**
   * 1-based rank in the canonical admin display_order ordering. Matches the row's
   * `#` value in the Shipment Settings → Sheet Rows admin tab, so staff can
   * cross-reference a Sheet row with its admin entry. Stable across per-user
   * reordering (which only changes the visual position, not this number).
   */
  global_position?: number;
  /**
   * Admin override for the Sheet's role-block grouping (a `ROLE_CHOICES` code,
   * set per row in the Shipment Settings → Sheet Rows admin tab). Empty/null
   * means "no override" — components/sheet/sheetRoleBlocks.ts falls back to
   * its static who-key→role table, then to the row's raw who-key.
   */
  role_group?: string | null;
}

// â”€â”€â”€ Sheet Row Settings v2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Admin shape â€” returned by /admin/sheet-rows/.
 * Fields are FLAT (not nested): label_tk/ru/en, description_tk/ru/en,
 * style_width/align/color â€” mirrors the serializer in views_sheet_settings.py.
 */
export interface ISheetRowSetting {
  // Identifiers (read-only)
  id: number;
  field_key: string;
  row_number: number;
  // Display (writable)
  display_order: number;
  is_visible: boolean;
  is_locked: boolean;
  /**
   * Which role-block this row groups under in the Sheet (writable). Empty
   * string = no override — see `IRowConfig.role_group`.
   */
  role_group: string;
  /** Phase 5c: True for admin-created runtime rows. Read-only â€” set by POST. */
  is_custom: boolean;
  // Labels (writable, flat)
  label_tk: string;
  label_ru: string;
  label_en: string;
  // "Who" column override (Phase 5a, writable, flat)
  who_tk: string;
  who_ru: string;
  who_en: string;
  // Descriptions (writable, flat)
  description_tk: string;
  description_ru: string;
  description_en: string;
  // Style (writable, flat)
  style_width: number | null;
  style_align: 'left' | 'center' | 'right' | null;
  style_color: string | null;
  style_font_color: string | null;
  // Cell text typography (Phase 5d). Blank string = baseline (bold, upright,
  // inherited font); admins override per row.
  style_font_weight: 'bold' | 'normal' | '';
  style_font_style: 'normal' | 'italic' | '';
  style_font_family: 'dm_sans' | 'inter' | 'mono' | 'serif' | '';
  style_font_size: number | null;
  // Permissions
  triggered_user: number | null;
  triggered_user_name: string | null;
  triggered_user_active: boolean | null;
  triggered_roles: string[];       // list of role codes (read-only, from role_triggers)
  extra_users: Array<{ id: number; name: string | null; is_active: boolean | null }>;
  // Concurrency / audit
  version: number;
  updated_at: string;
  updated_by_name: string | null;
  deleted_at: string | null;
  // Canonical i18n keys from DEFAULT_SHEET_ROWS (null for is_custom rows).
  // Used by the admin Sheet Rows table to render the translated default as
  // a placeholder / "default: X" hint when label_* / who_* are blank.
  default_label_key: string | null;
  default_who_key: string | null;
}

/**
 * Per-row entry inside /shipments/{id}/sheet/ payload's row_settings dict.
 * Keyed by field_key. Labels/description/style are nested objects (compact form).
 * No `is_visible` â€” hidden rows are excluded from the dict entirely.
 */
export interface ISheetRowSettingForUser {
  /**
   * SheetRowSetting.id. Required for the user-prefs PATCH endpoint, which
   * keys by numeric id. Null when no SheetRowSetting DB row exists for this
   * field_key (fallback config) â€” frontend skips reorder/hide controls in
   * that case.
   */
  id: number | null;
  is_locked: boolean;
  labels: { tk?: string; ru?: string; en?: string } | null;
  /** Phase 5a: per-row override of Col B "Who" label. Null = fall back to default_who_key i18n. */
  who: { tk?: string; ru?: string; en?: string } | null;
  description: { tk?: string; ru?: string; en?: string } | null;
  style: {
    width?: number;
    align?: 'left' | 'center' | 'right';
    color?: string;
    font_color?: string;
    font_weight?: 'bold' | 'normal';
    font_style?: 'normal' | 'italic';
    font_family?: 'dm_sans' | 'inter' | 'mono' | 'serif';
    font_size?: number;
  } | null;
  triggered_user_id: number | null;
  triggered_roles: string[];
  extra_user_ids: number[];
  can_current_user_edit: boolean;
  version: number | null;
  settings_updated_at: string | null;
  settings_updated_by_id: number | null;
}

// â”€â”€â”€ Cell-level last-edit summary (sparse â€” only present if the cell was ever edited) â”€â”€

export interface ICellLastEdit {
  user_id: number;
  user_name: string;
  old_value: string;
  new_value: string;
  edited_at: string;  // ISO 8601
}

// â”€â”€â”€ Field history entry (full audit log row) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IFieldHistoryEntry {
  user_id: number;
  user_name: string;
  old_value: string;
  new_value: string;
  edited_at: string;  // ISO 8601
}

// â”€â”€â”€ Truck split defaults (admin-configurable per # of firms) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ITruckSplitDefault {
  id: number;
  num_firms: number;
  kg_per_firm: string;
  notes: string | null;
  updated_at: string;
  updated_by_name: string | null;
}

// â”€â”€â”€ Detail / Related â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IFirmSplit {
  export_firm_id: number;
  export_firm_name: string | null;
  weight_kg: number;
  amount_usd: number | null;
  invoice_number: string | null;
}

export interface IBlockSource {
  block_id?: number;
  block_code: string;
  block_name?: string | null;
  weight_kg: number | null;
  // Per-block harvest day. Multi-block trucks can have different dates;
  // the Sheet R39 cell renders the min-max range across all block sources.
  harvest_date?: string | null;
}

export interface IStatusLogEntry {
  status_code: string;
  status_display: string;
  changed_by_name: string;
  changed_at: string;
  comment: string | null;
  // State machine v2: true when the transition was fired by auto-advance
  // rather than an explicit user click. UI renders an "Auto" badge.
  is_auto?: boolean;
}

export interface IShipmentComment {
  id: number;
  user_name: string;
  role: string;
  content: string;
  field_key: string | null;
  parent_comment: number | null;
  is_system: boolean;
  is_deleted: boolean;
  // Task fields
  assignee: number | null;
  assignee_name: string | null;
  is_done: boolean;
  done_at: string | null;
  done_by_name: string | null;
  // Mentions (denormalized objects from serializer â€” chips render names without N+1)
  mentions_users: { id: number; name: string; role: string }[];
  role_mentions_list: { code: string; label: string }[];
  // Thread
  replies_count: number;
  created_at: string;
  updated_at: string | null;
}

// â”€â”€â”€ Comments / Mentions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IMentionUser {
  type: 'user';
  id: number;
  name: string;
  role: string;
}

export interface IMentionRole {
  type: 'role';
  code: string;
  label: string;
  member_count: number;
}

export type IMentionable = IMentionUser | IMentionRole;

export type ICommentTaskStatus = 'open' | 'done';

export interface ICommentFilter {
  fieldKey?: string;
  assigneeMe?: boolean;
  taskStatus?: ICommentTaskStatus;
}

// â”€â”€â”€ Greenhouse Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IGreenhouseConfig {
  id: number;
  plan_deadline_weekday: number;        // 0=Mon â€¦ 6=Sun, default 4 (Friday)
  plan_late_until_weekday: number;      // default 6 (Sunday)
  plan_critical_late_at_weekday: number; // default 0 (Monday)
  plan_critical_late_at_time: string;   // "HH:MM:SS"
  forecast_primary_open: string;        // "HH:MM:SS"
  forecast_primary_close: string;
  forecast_fallback_close: string;
  forecast_same_day_close: string;
  notification_lead_minutes: number;
  truck_capacity_kg: string;            // Decimal as string
  operating_days_bitmask: number;       // bits 0â€“6 = Monâ€“Sun
  timezone_name: string;
  updated_by: number | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

export interface IOperatingDayException {
  id: number;
  date: string;        // ISO date YYYY-MM-DD
  is_holiday: boolean; // true = skip this otherwise-operating day
  note: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

// â”€â”€â”€ Harvest Day Entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type PlanState = 'on_time' | 'late' | 'critical_late';
export type ForecastWindow = 'primary' | 'fallback' | 'same_day_red_flag';
export type ActualSource =
  | 'manual'
  | 'pallet_rollup_pending'
  | 'shipment_rollup'
  | 'admin_override';

export interface IHarvestDayEntry {
  id: number;
  weekly_plan: number;
  season: number;
  block: number;
  block_code: string;
  block_name: string;
  entry_date: string;          // ISO date YYYY-MM-DD
  weekday: number;             // 0=Mon â€¦ 6=Sun
  plan_value: string | null;
  plan_submitted_at: string | null;
  plan_submitted_by: number | null;
  plan_submitted_by_name: string | null;
  plan_state: PlanState | '';
  forecast_value: string | null;
  forecast_submitted_at: string | null;
  forecast_submitted_by: number | null;
  forecast_submitted_by_name: string | null;
  forecast_window: ForecastWindow | '';
  forecast_revision_count: number;
  actual_value: string | null;
  actual_finalized_at: string | null;
  actual_source: ActualSource | '';
  last_override_at: string | null;
  last_override_by: number | null;
  last_override_by_name: string | null;
  last_override_reason: string;
  created_at: string;
  updated_at: string;
}

export interface IDayEntryHistoryItem {
  id: number;
  user: number | null;
  user_name: string | null;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  detail: string;
  created_at: string;
}

// â”€â”€â”€ Planning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Daily harvest board (Ýük plan we galyndy)
export interface IDailyBoardRow {
  block: number;
  block_code: string;
  block_name: string | null;
  entry_id: number | null;
  entry_date: string;            // ISO date YYYY-MM-DD
  yesterday_rest: string | null; // Düýnki galyndy (kg)
  today_plan: string | null;     // Bu günki meýilleşdirilýän ýygym (kg)
  total: string | null;          // Jemi (kg) — yesterday_rest + today_plan
  note: string;                  // Bellik
  entered_at: string | null;     // Girizilen senesi (ISO datetime)
  entered_by_name: string | null;
}

export interface IDailyBoardResponse {
  date: string;
  season: { id: number; name: string } | null;
  results: IDailyBoardRow[];
}

export type PlanStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface IWeeklyHarvestPlan {
  id: number;
  season: number;
  season_name: string;
  block: number;
  block_code: string;
  block_name: string;
  block_manager_names: string[];
  week_number: number;
  year: number;
  locked_at: string | null;
  entered_by_name: string | null;
  updated_at: string;
  // Late-edit extension fields (AD: admin can grant a window past Sunday cutoff)
  late_edit_granted_until: string | null;
  late_edit_granted_by: number | null;
  late_edit_granted_by_name: string | null;
  late_edit_granted_at: string | null;
  late_edit_granted_reason: string;
  late_edit_active: boolean;
}

export interface IWeeklyLocalSellPlan {
  id: number;
  season: number | null;
  season_name: string | null;
  export_firm: number;
  export_firm_name: string | null;
  week_number: number;
  year: number;
  monday_plan_kg: number;
  tuesday_plan_kg: number;
  wednesday_plan_kg: number;
  thursday_plan_kg: number;
  friday_plan_kg: number;
  saturday_plan_kg: number;
  total_plan_kg: number;
  status: PlanStatus;
  submitted_at: string | null;
  submitted_by_name: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  rejected_at: string | null;
  rejected_by_name: string | null;
  rejection_note: string | null;
  entered_by_name: string | null;
  updated_at: string;
}

// â”€â”€â”€ Quota Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IQuotaIssuanceFirmAllocation {
  id: number;
  export_firm: number;
  export_firm_name: string | null;
  kg_quota: number;
  used_kg: number;
}

export type QuotaUsageStatus = 'draft' | 'approved';

export interface IQuotaUsageRecord {
  id: number;
  usage_date: string;
  export_firm: number;
  export_firm_name: string;
  kg_used: number;
  product_type: string;
  status: QuotaUsageStatus;
  notes: string;
  shipment: number | null;
  shipment_code: string | null;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string | null;
}

export interface IQuotaIssuance {
  id: number;
  issue_date: string;
  product_type: 'tomato' | 'pepper';
  validity: 'this_month' | 'this_and_next' | 'next_month';
  matched_week: number;
  matched_year: number;
  is_manually_reassigned: boolean;
  notes: string;
  total_kg: number;
  allocations: IQuotaIssuanceFirmAllocation[];
  created_at: string;
}

export interface IQuotaDashboardKPIs {
  local_sales_kg: number;
  expected_kg: number;
  issued_kg: number;
  not_given_kg: number;
  not_given_pct: number;
  used_kg: number;
  unused_kg: number;
  unused_pct: number;
  expired_kg: number;
}

export interface IQuotaDashboardFirm {
  export_firm: number;
  export_firm_name: string;
  sales_kg: number;
  expected_kg: number;
  issued_kg: number;
  used_kg: number;
  not_given_kg: number;
  not_given_pct: number;
  unused_kg: number;
  expired_kg: number;
  is_blocked: boolean;
}

export interface IWeeklyFlowIssuance {
  issue_date: string;
  total_kg: number;
}

export interface IWeeklyFlowFirm {
  firm_name: string;
  sold_kg: number;
  expected_kg: number;
  got_kg: number;
  diff_kg: number;
}

export interface IWeeklyFlow {
  week: number;
  year: number;
  date_from: string;
  date_to: string;
  sales_kg: number;
  expected_kg: number;
  issued_kg: number;
  gap_kg: number;
  coverage_pct: number;
  issuances: IWeeklyFlowIssuance[];
  firms: IWeeklyFlowFirm[];
}

export interface IQuotaDashboardResponse {
  kpis: IQuotaDashboardKPIs;
  per_firm: IQuotaDashboardFirm[];
  weekly_flow: IWeeklyFlow[];
}

export interface IPriceEntry {
  id: number;
  date: string;
  city: number;
  city_name: string;
  price_local: number | null;
  price_usd: number | null;
  currency: string;
  source: string;
  entered_by_name: string | null;
  created_at: string;
}

export interface IShipmentQuality {
  azyk_maglumatnama: boolean;
  suriji_gozukdiriji: boolean;
  hil_sertifikaty: boolean;
  kalibrowka_analiz: boolean;
}

// ─── Sales Report (rich, line-item + expense tables) ──────────────────────────

// String code union — kept as type for category_code on read responses and IExpenseRow.
// The wire format now uses integer PKs for mutations (category: number in ISalesReportExpenseInput).
export type SalesReportExpenseCategory =
  | 'TOM_ROSHOD'
  | 'NAKLIYE'
  | 'BAZAR_ROSHOD'
  | 'INTERES'
  | 'UZBEK_FURA_AWANS'
  | 'DOZWOL'
  | 'ANALIZ'
  | 'PROSTOY'
  | 'PERESEPKA'
  | 'ARAP'
  | 'KASPIY_KOMIS'
  | 'UZBEK_FURA_SOLYARKA'
  | 'NDS'
  | 'SBOR'
  | 'UZB_KAZ_POST'
  | 'UZB_KAZ_NAKLIYE'
  | 'UZBEK_TAM'
  | 'MOI'
  | 'DOSMOTR'
  | 'PEREWOT'
  | 'OTHER';

// Admin-managed expense category template (from GET /api/v1/export/expense-categories/)
export interface IExpenseCategory {
  readonly id: number;
  readonly code: string;
  readonly name_tk: string;
  readonly name_ru: string | null;
  readonly name_en: string | null;
  readonly logo_code: string | null;
  readonly sort_order: number;
  readonly is_active: boolean;
}

export interface ISalesReportLineItem {
  readonly line_number: number;
  readonly product_name: string | null;
  readonly quantity_kg: string;        // Decimal as string
  readonly price_local: string;        // Decimal as string
  readonly amount_local: string;       // server-computed: qty × price
}

export interface ISalesReportExpense {
  // BREAKING CHANGE (Phase 1): category is now integer PK on the wire
  readonly category: number;
  readonly category_code: string;      // read-only string code from server
  readonly category_display: string;   // read-only localized label from server
  readonly logo_code: string | null;   // read-only
  readonly label_raw: string | null;   // verbatim original text (import fidelity)
  readonly amount_local: string;       // Decimal as string
}

export interface ISalesReport {
  // Header
  readonly currency: string;                  // default 'KZT'
  readonly exchange_rate: string | null;       // Kurs: local units per USD
  readonly weight_loaded_kg: string | null;
  readonly weight_sold_kg: string | null;
  readonly weight_rejected_kg: string | null;
  readonly price_per_kg: string | null;        // legacy back-compat
  readonly notes: string | null;
  // Server-computed totals (local currency)
  readonly total_sales_local: string | null;
  readonly total_expenses_local: string | null;
  readonly net_income_local: string | null;
  // Server-computed USD equivalents (= *_local / exchange_rate)
  readonly total_sales_usd: string | null;
  readonly total_expenses_usd: string | null;
  readonly net_income_usd: string | null;
  // Legacy back-compat flat fields (ignored in new UI)
  readonly total_usd: string | null;
  readonly transport_cost_usd: string | null;
  readonly market_fee_usd: string | null;
  readonly other_expenses_usd: string | null;
  // Nested children
  readonly line_items: ISalesReportLineItem[];
  readonly expenses: ISalesReportExpense[];
  // Audit
  readonly created_at: string;
  readonly updated_at: string;
}

// ─── Sales Report mutation payload ────────────────────────────────────────────

export interface ISalesReportLineItemInput {
  line_number: number;
  product_name?: string | null;
  quantity_kg: number | string;
  price_local: number | string;
  amount_local?: number | string;   // optional — server computes if omitted
}

export interface ISalesReportExpenseInput {
  // BREAKING CHANGE (Phase 1): category is now integer PK
  category: number;
  label_raw?: string | null;
  amount_local: number | string;
}

export interface ISalesReportPayload {
  currency?: string;
  exchange_rate?: number | string | null;
  weight_loaded_kg?: number | string | null;
  weight_sold_kg?: number | string | null;
  weight_rejected_kg?: number | string | null;
  price_per_kg?: number | string | null;
  notes?: string | null;
  line_items?: ISalesReportLineItemInput[];
  expenses?: ISalesReportExpenseInput[];
}

export interface IOverdueShipment extends IShipmentListItem {
  days_overdue: number;
  has_sales_report: boolean;
}

// ─── Sales Rep Reports ────────────────────────────────────────────────────────────────

/** Flat shipment row returned by GET /export/shipments/my-sales-reports/ */
export interface ISalesRepShipment extends IShipmentListItem {
  has_sales_report: boolean;
}

/** One row from GET /export/sales-rep-coverage/ */
export interface ISalesRepCoverage {
  sales_rep: number;
  sales_rep_name: string;
  customer_ids: number[];
}

// â”€â”€â”€ Truck Allocations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ITruckDestination {
  id: number;
  name: string;
  country: number | null;
  country_name: string | null;
  sort_order: number;
  is_active: boolean;
  is_default: boolean;
}

export interface IWeeklyDestinationSelection {
  id: number;
  season: number;
  week_number: number;
  year: number;
  destination: number;
  destination_name: string;
}

export interface ITruckDestinationSplit {
  id: number;
  destination: number;
  destination_name: string;
  truck_count: number;
}

export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface IWeeklyTruckAllocation {
  id: number;
  season: number;
  season_name: string;
  week_number: number;
  year: number;
  day_of_week: DayOfWeek;  // 1=Mon, 7=Sun
  total_planned_kg: number | null;
  total_trucks_calc: number | null;
  destination_splits: ITruckDestinationSplit[];
  decided_by_name: string | null;
  created_at: string;
}

export interface IBlockSummary {
  block_id: number;
  block_code: string;
  block_name: string;
  total_plan_kg: number;
  total_actual_kg: number | null;  // null when no actuals entered for the week
  deficit_kg: number | null;        // null when total_actual_kg is null
  on_time_count: number;
  late_count: number;
  critical_late_count: number;
}

// â”€â”€â”€ Domestic Sales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IDomesticSale {
  id: number;
  date: string;
  buyer: number;
  buyer_name: string;
  block: number;
  block_code: string;
  block_name: string;
  export_firm: number | null;
  export_firm_name: string | null;
  weight_kg: number;
  variety: string | null;
  price_per_kg: number | null;
  tabel_no: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

// â”€â”€â”€ Advances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IAdvanceShipmentLink {
  shipment: number;
  shipment_code: string;
  allocated_amount: number | null;
}

export interface IFinansistAdvanceListItem {
  id: number;
  batch_code: string | null;
  advance_date: string;
  total_amount: number;
  currency: string;
  purpose: string | null;
  issued_by: number;
  issued_by_name: string;
  reconciled: boolean;
  reconciled_at: string | null;
  created_at: string;
  shipment_count: number;
  allocated_total: number;
}

export interface IFinansistAdvanceDetail extends IFinansistAdvanceListItem {
  notes: string | null;
  shipment_links: IAdvanceShipmentLink[];
}

// ─── Customs / Document Cash-Advance Ledger ───────────────────────────────────

export const CUSTOMS_EXPENSE_CATEGORIES = [
  'GUMRUKLEME',
  'KARANTIN',
  'CT1',
  'FITO',
  'ANALIZ',
  'PASPORT_SDELKA',
  'PLATYOSKA',
  'DOC_POST',
  'YUZLENME_HAT',
  'GUMRUK_AMAL',
  'BORDER_RETURN',
  'SERTNAMA',
  'OTHER',
] as const;

export type CustomsExpenseCategory = typeof CUSTOMS_EXPENSE_CATEGORIES[number];

export interface ICustomsExpense {
  id: number;
  expense_date: string;           // YYYY-MM-DD
  category: CustomsExpenseCategory;
  category_display: string;
  amount: string;                 // Decimal as string — parse with Number()
  currency: string;               // “TMT”
  shipment: number | null;
  shipment_code: string | null;
  export_code_raw: string | null;
  vehicle_plate: string | null;
  route_label: string | null;
  label_raw: string | null;
  quantity: number | null;
  notes: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

export interface ICustomsExpensePayload {
  expense_date: string;           // YYYY-MM-DD
  category: CustomsExpenseCategory;
  amount: string;                 // send as decimal string
  currency?: string;
  shipment?: number | null;
  export_code_raw?: string | null;
  vehicle_plate?: string | null;
  route_label?: string | null;
  label_raw?: string | null;
  quantity?: number | null;
  notes?: string | null;
}

export interface ICustomsExpenseFilters {
  page?: number;
  page_size?: number;
  category?: CustomsExpenseCategory | '';
  currency?: string;
  shipment?: number;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface ICustomsLedgerByCategoryRow {
  category: CustomsExpenseCategory;
  category_display: string;
  total: string;   // Decimal string
  count: number;
}

export interface ICustomsLedgerByDateRow {
  date: string;    // YYYY-MM-DD
  advances: string;
  expenses: string;
}

export interface ICustomsLedger {
  currency: string;
  advances_total: string;
  expenses_total: string;
  balance: string;
  by_category: ICustomsLedgerByCategoryRow[];
  by_date: ICustomsLedgerByDateRow[];
}

// ─── Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ILoadingLocation {
  id: number;
  name: string;
}

export interface ITomatoVariety {
  id: number;
  name: string;
  type: string | null;
  avg_fruit_weight_gr: string | null;
  code: string | null;
  is_experimental: boolean;
  scientific_name: string;
  color?: string | null;
  sort_order?: number;
}

export interface IGreenhouseBlockSub {
  id: number;
  code: string;
  name: string | null;
  variety_main: number | null;
  variety_main_name: string | null;
  variety_secondary: number | null;
  variety_secondary_name: string | null;
  area_m2: number | null;
  section_count: number | null;
  sowing_date: string | null;
  is_active: boolean;
}

export interface IGreenhouseBlock {
  id: number;
  code: string;
  name: string | null;
  parent: number | null;
  parent_code: string | null;
  manager: number | null;
  manager_name: string | null;
  variety_main: number | null;
  variety_main_name: string | null;
  variety_secondary: number | null;
  variety_secondary_name: string | null;
  area_m2: number | null;
  location: number | null;
  location_name: string | null;
  section_count: number | null;
  sowing_date: string | null;
  season_start_month: number | null;
  color?: string | null;
  sort_order?: number;
  is_active: boolean;
  sub_blocks: IGreenhouseBlockSub[];
}

export interface IBlockAssignment {
  id: number;
  user: number;
  user_name: string;
  block: number;
  block_code: string;
  block_name: string | null;
  is_active: boolean;
}

export type SeasonStatus = 'UPCOMING' | 'ACTIVE' | 'CLOSED';

export interface ISeason {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  status: SeasonStatus;
  closed_at: string | null;
  closed_by: number | null;
  closed_by_name: string | null;
}

/** Counters shown in the close-season confirm dialog (`GET .../close-preview/`). */
export interface ISeasonClosePreview {
  drafts: number;
  in_transit: number;
  open_tasks: number;
  unfinished_plans: number;
  /**
   * Draft quota-usage rows in the season. Unlike the four above — which are
   * hidden and return read-only — these become permanently unapprovable once
   * the season is closed, so the dialog warns separately when it is > 0.
   */
  draft_quota_usage: number;
}

export interface IAdminUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  permissions: string[];
}

export interface INotification {
  id: number;
  kind: 'quota_80' | 'quota_90' | 'quota_95' | 'quota_100' | 'overdue' | 'action_required' | 'plan_submitted' | 'plan_approved' | 'plan_rejected' | 'mention' | 'task_assigned' | 'task_done' | 'feedback_resolved' | 'feedback_rejected';
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// Filterable action values exposed by the audit viewset. The `action` column
// itself carries many more free-form codes (plan_value_set, variety_override,
// soft_delete, …) written by services — hence IAuditLog.action is a plain string.
export type AuditAction = 'transition' | 'create' | 'update';

export interface IAuditLog {
  id: number;
  user: number | null;
  user_name: string | null;
  action: string;
  model_name: string;
  object_id: number;
  object_repr: string;
  detail: string;
  created_at: string;
}

// â”€â”€â”€ Shipment (detail) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// ─── Variety inline shape (shared between IShipmentDetail and IShipmentSheetItem) ─

export interface IVarietyInline {
  id: number;
  code: string | null;
  name: string;
  is_experimental: boolean;
}

// ─── Completeness block (shipment detail — Task 3) ───────────────────────────

export interface IMissingField {
  key: string;
  title_key: string;
  step: string;
  role: string;
}

export interface IManualTask {
  id: number;
  title_key: string;
  role: string;
  is_overdue: boolean;
}

export interface ICompleteness {
  required_total: number;
  filled_count: number;
  missing_fields: IMissingField[];
  manual_tasks: IManualTask[];
}

export interface IShipmentDetail extends IShipmentListItem {
  status_code: string;
  allowed_transitions: string[];
  box_count: number | null;
  pallet_count: number | null;
  packaging_kg: number | null;
  vehicle_condition: VehicleCondition | null;
  vehicle_condition_note: string | null;
  price_per_kg: number | null;
  total_amount_usd: number | null;
  loading_started_at: string | null;
  customs_entry_at: string | null;
  customs_exit_at: string | null;
  border_crossed_at: string | null;
  sale_started_at: string | null;
  sale_ended_at: string | null;
  notes: string | null;
  export_manager_note: string | null;
  warehouse_note: string | null;
  document_note: string | null;
  sales_report_date: string | null;
  harvest_date: string | null;
  customs_clearance_planned_day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | '' | null;
  // R4 — Şirin logs when transport dept handed over docs (null = Berilmedi)
  transport_docs_given_at: string | null;
  // State machine v2: when True, the lifecycle includes a `transshipment`
  // step between barysh_gumrugi and bardy. RouteTimelineRail uses this to
  // decide whether to render the transshipment slot.
  // (has_peregruz inherited from IShipmentListItem as a required boolean.)
  created_at: string;
  updated_at: string;
  firm_splits: IFirmSplit[];
  block_sources: IBlockSource[];
  status_log: IStatusLogEntry[];
  comments: IShipmentComment[];
  /** Non-deleted root comment (thread) count — drives the hero discussion badge. */
  comment_count: number;
  quality: IShipmentQuality | null;
  sales_report: ISalesReport | null;
  /** Customs / document expenses for this shipment (from customs-expenses API). */
  customs_expenses?: ICustomsExpense[];
  platform_id: number;
  variety_confidence: 'high' | 'low' | 'none';
  variety_confidence_display: string;
  varieties_dominant: IVarietyInline[];
  rejected_weight_kg: number | null;
  vehicle_responsible: string | null;
  // FK ids â€” exposed for the Edit drawer's dropdowns. Names are inherited from IShipmentListItem.
  country: number | null;
  customer: number | null;
  city: number | null;
  variety: number | null;
  border_point: number | null;
  import_firm: number | null;
  loading_location: number | null;
  // Task system (Stream D1)
  my_task: ITaskDetail | null;
  other_tasks: ITaskListItem[];
  in_phase_seconds: number;
  phase_avg_seconds: number | null;
  // Stream F — true when the draft is ready to be promoted to yuklenme
  // (every auto-resolving draft task is DONE/CANCELLED). Manual draft tasks
  // do NOT block the flag — promotion is the user's call.
  can_promote_from_draft: boolean;
  completeness: ICompleteness;
}
// ─── Cancel Shipment mutation response ───────────────────────────────────────

/**
 * Response shape for POST /api/v1/export/shipments/{id}/cancel/.
 * Extends the full shipment detail with two quota-cleanup fields that are
 * only present on the cancel response — not on GET detail.
 */
export interface ICancelShipmentResponse extends IShipmentDetail {
  /** Number of draft QuotaUsageRecords deleted during cancellation. */
  draft_quota_deleted: number;
  /** IDs of approved QuotaUsageRecords that need manual reconciliation. */
  approved_quota_to_reconcile: number[];
}

// ─── Task system (Stream B / D1) ───────────────────────────────────────────────────────────────────

export type TaskState = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export type TaskCompletionRule = 'all_fields_filled' | 'any_field_filled' | 'manual_done';

export type TaskKind = 'shipment' | 'weekly_plan' | 'local_sell_plan';

export interface ITaskListItem {
  id: number;
  kind: TaskKind;
  /** Null for `weekly_plan` tasks. */
  shipment: number | null;
  shipment_code: string;
  step: string;
  phase: ShipmentPhase;
  title_key: string;
  assignee_role: string;
  assignee_user: number | null;
  assignee_user_name: string | null;
  target_fields_list: string[];
  completion_rule: TaskCompletionRule;
  deadline: string | null;
  deadline_rule: string;
  state: TaskState;
  is_overdue: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  // Stream G: blocked_reason surfaced on the list serializer too so the
  // Detail page's OtherTasksRow modal doesn't need an extra fetch.
  blocked_reason: string;
  // weekly_plan task fields (null for shipment tasks)
  link: string;
  scope_year: number | null;
  scope_week: number | null;
  /** Block PK a weekly_plan task covers; null for shipment tasks. */
  scope_block: number | null;
  /** Block code (e.g. "K") a weekly_plan task covers; null for shipment tasks. */
  scope_block_code: string | null;
}

export interface ITaskDetail extends ITaskListItem {
  blocked_reason: string;
  blocked_by: number[];
  rule: number | null;
  duration_seconds: number | null;
}



// â”€â”€â”€ Draft Shipments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IShipmentDraft {
  id: number;
  shipment_code: string;
  date: string;
  created_at: string;
  created_by_name: string | null;
  weight_net: number | null;
  block_sources: IBlockSource[];
  export_code: string | null;
  previous_platform_id: number | null;
  harvest_age_days: number;
  freshness: 'today' | 'yesterday' | 'aged';
  variety_confidence: 'high' | 'low' | 'none';
  // Join-supply candidate fields (Phase A, 2026-08-14). The backend's
  // ShipmentDraftListSerializer never emits raw `country`/`customer` FK ids —
  // only `country_name`/`customer_name` (inherited from
  // ShipmentListSerializer.Meta.fields; verified against
  // backend/apps/export/serializers.py). Optional because existing object
  // literals (mock/drafts.ts, useDrafts.ts mock stubs) don't set them. A
  // destination-vs-supply filter must key off *_name — there are no raw ids
  // to key off of here.
  country_name?: string | null;
  customer_name?: string | null;
}

export interface IDraftFirmSplitInput {
  export_firm: number;
  weight_kg: number;
  amount_usd?: number;
  split_order?: number;
}

export interface IDraftCreatePayload {
  shipment_code: string;
  date: string;
  is_draft: true;
  block_sources?: { block_id: number; weight_kg: number }[];
  // Supply draft: block IDs + total weight in place of per-block `block_sources`
  block_ids?: number[];
  weight_net?: number;
  harvest_status?: string;
  notes?: string;
  export_code?: string;
  // Join flow — supply draft: skip the forecast pool check
  skip_forecast_check?: boolean;
  // Join flow — destination draft: no blocks, has destination
  variety?: number | null;
  /** Multiple variety IDs (1–4). First = primary/dominant. Supersedes single `variety` when present. */
  varieties?: number[];
  import_firm?: number | null;
  country?: number | null;
  city?: number | null;
  customer?: number | null;
  firm_splits?: IDraftFirmSplitInput[];
}

/**
 * Payload for creating a SUPPLY draft (blocks + total weight, NO
 * per-block split, NO destination). Distinct from `IDraftCreatePayload`
 * because `shipment_code`/`date`/`is_draft` are server-assigned on this
 * path, not caller-supplied — see `useCreateSupplyDraft`.
 */
export interface ISupplyDraftPayload {
  weight_net: number;
  block_ids: number[];
  /** Multiple variety IDs (1–4). First = primary/dominant. */
  varieties?: number[];
  harvest_status?: string;
  export_code?: string;
  notes?: string;
}

export interface IDraftAssignPayload {
  country: number | null;
  city: number | null;
  customer: number | null;
  import_firm: number | null;
  firm_splits?: { export_firm_id: number; weight_kg: number }[];
  border_point?: number | null;
}

// ─── Harvest Forecast ─────────────────────────────────────────────────────────

/** One block's remaining forecast for a given date.
 *  Backend returns decimals as strings — use Number() when arithmetic is needed. */
export interface IForecastRemaining {
  block_id: number;
  block_code: string;
  forecast_kg: string;
  allocated_kg: string;
  remaining_kg: string;
}

export interface IForecastSubmitEntry {
  block_id: number;
  forecast_kg: number | string;
}

export interface IForecastSubmitPayload {
  date: string;        // 'YYYY-MM-DD'
  entries: IForecastSubmitEntry[];
}

export interface IForecastSubmitResult {
  saved: number;
  date: string;
  entries: { block_id: number; block_code: string; forecast_kg: string }[];
  errors?: string[];
}

//â”€â”€â”€ Assignment Board (mock demand) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type DemandType = 'contract' | 'quota' | 'queue';

export interface IDemandItem {
  id: number;
  type: DemandType;
  label: string;
  customer: string;
  country: string;
  firm: string;
  remaining: string;
  due_days: number;
  pref: string;
  strict: boolean;
}

// â”€â”€â”€ Pallet Manifest (Phase 2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ICrateType {
  id: number;
  name: string;
  weight_kg: string;   // Decimal serialised as string
  is_active: boolean;
}

export interface IPallet {
  id: number;
  shipment: number;
  pallet_number: number;
  crate_type: number;
  crate_type_name: string;
  crate_type_weight_kg: string;
  crate_count: number;
  gross_weight_kg: string;
  pallet_weight_kg: string;
  additions_kg: string;
  net_weight_kg: string;   // computed read-only
  variety: number;
  variety_code: string | null;
  variety_name: string;
  sub_block: number;
  sub_block_code: string;
  loaded_at: string;       // ISO
  created_by_name: string | null;
}

export interface IPalletUpsertRow {
  pallet_number: number;
  crate_type: number;
  crate_count: number;
  gross_weight_kg: number | string;
  pallet_weight_kg: number | string;
  additions_kg: number | string;
  variety: number;
  sub_block: number;
  loaded_at?: string;
}

// ─── Weightmaster Excel import (dry-run preview) ────────────────────────────

export interface IWeightmasterPreviewRow {
  pallet_number: number;
  gross_weight_kg: string;
  crate_count: number;
  pallet_weight_kg: string;
  additions_kg: string;
  crate_type: number | null;      // null = not resolved (fix in grid)
  crate_type_name: string;
  variety: number | null;
  variety_name: string;
  sub_block: number | null;
  sub_block_code: string;
}

export interface IWeightmasterWarning {
  row: number;                    // 1-based Excel row
  pallet_number: number | null;
  field: 'crate_type' | 'variety' | 'sub_block' | 'row';
  raw: string;
  message: string;
}

export interface IWeightmasterPreview {
  rows: IWeightmasterPreviewRow[];
  warnings: IWeightmasterWarning[];
  summary: {
    load_code: string;
    harvest_date: string | null;
    pallet_count: number;
    total_gross_kg: string;
    total_net_kg: string;
    code_mismatch: boolean;
  };
}

// ─── Block × variety breakdown (parent-grain rollup from pallets) ────────────

export interface IBlockBreakdownRow {
  block_id: number;
  block_code: string;       // parent block, e.g. "F" (F1/F2 summed)
  block_name: string;
  variety_id: number;
  variety_name: string;
  weight_kg: string;
}

export interface IBlockBreakdown {
  rows: IBlockBreakdownRow[];
  total_net_kg: string;
}

// â”€â”€â”€ Feedback Module â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type FeedbackCategory = 'bug' | 'suggestion' | 'question';
export type FeedbackStatus = 'new' | 'in_review' | 'resolved' | 'rejected';
export type FeedbackReplyMode = 'standard' | 'internal' | 'public';

export interface IFeedbackAttachment {
  id: number;
  file: string;            // URL string
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface IFeedbackReply {
  id: number;
  author: number;
  author_name: string;
  author_role: string;
  content: string;
  mode: FeedbackReplyMode;
  is_internal: boolean;
  is_public: boolean;
  attachments: IFeedbackAttachment[];
  created_at: string;
}

/** List-level shape â€” lightweight, no replies or attachments. */
export interface IFeedbackTicket {
  id: number;
  category: FeedbackCategory;
  category_display: string;
  description: string;
  status: FeedbackStatus;
  status_display: string;
  is_public: boolean;
  author: number;
  author_name: string;
  author_role: string;
  created_at: string;
  last_activity_at: string;
}

/** Full detail shape â€” includes attachments and replies. */
export interface IFeedbackTicketDetail extends IFeedbackTicket {
  submitted_from_path: string;
  submitted_from_label: string;
  attachments: IFeedbackAttachment[];
  replies: IFeedbackReply[];
  resolved_at: string | null;
}

/** Create payload (converted to FormData in the hook). */
export interface IFeedbackTicketCreate {
  category: FeedbackCategory;
  description: string;
  submitted_from_path: string;
  submitted_from_label?: string;
  user_agent: string;
  attachments: File[];
}

/** Reply create payload (converted to FormData in the hook). */
export interface IFeedbackReplyCreate {
  content: string;
  mode: FeedbackReplyMode;
  attachments: File[];
}

export interface IFeedbackFilters {
  scope?: 'mine' | 'public' | 'all';
  status?: FeedbackStatus | '';
  category?: FeedbackCategory | '';
  author?: number | '';
  search?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}

// ─── Document packets (Documents page) ───────────────────────────────────────

export interface IDocumentPacketFirm {
  readonly export_firm_id: number;
  readonly export_firm_name: string;
  readonly sale_id: number | null;      // drives the per-firm invoice/letter buttons
  readonly invoice_number: number | null;
}

export interface IDocumentPacket {
  readonly id: number;                  // shipment (truck) id
  readonly shipment_code: string;
  readonly date: string | null;
  readonly status_code: string | null;
  readonly status_display: string | null;
  readonly country_name: string | null;
  readonly city_name: string | null;
  readonly buyer_name: string | null;
  readonly packing_complete: boolean;
  readonly missing_packing: readonly string[];
  readonly missing_setup: readonly string[];   // buyer/country/driver/plate still empty
  readonly is_ready: boolean;                   // setup + packing both done
  readonly firms: readonly IDocumentPacketFirm[];
}

export interface IDocumentPacketFilters {
  date?: string;
  status?: string;
  firm?: number;
  page?: number;
  pageSize?: number;
}

// ─── Process node links (boss BPMN diagram -> screen mapping) ──────────────

export interface IProcessNodeLink {
  id: number;
  node_id: string;
  label: string;
  route: string;
  is_active: boolean;
}
