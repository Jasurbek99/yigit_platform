// ─── Auth ─────────────────────────────────────────────────────────────────

export type UserRole =
  | 'export_manager'
  | 'warehouse_chief'
  | 'document_team'
  | 'transport'
  | 'sales_rep'
  | 'finansist'
  | 'director'
  | 'accountant'
  | 'greenhouse_manager';

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
}

// ─── Reference ────────────────────────────────────────────────────────────

export interface ICountry {
  id: number;
  name_tk: string;
  name_ru: string | null;
  name_en: string | null;
  code: string | null;
}

export interface ICity {
  id: number;
  name: string;
  name_local: string | null;
  country: number;
}

export interface IExportFirm {
  id: number;
  code: string;
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
  tax_code: string | null;
  swift_code: string | null;
  one_c_code: string | null;
  is_active: boolean;
  is_gapy_satys: boolean;
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
  phone: string | null;
  is_active: boolean;
  is_gapy_satys: boolean;
  director_signature: string | null;
  director_seal: string | null;
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

// ─── API helpers ──────────────────────────────────────────────────────────

export interface IApiListResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface IApiError {
  error: string;
}

// ─── Shipment ─────────────────────────────────────────────────────────────

export type VehicleCondition = 'OK' | 'ISSUE' | 'BREAKDOWN' | 'RETURNED';

export interface IShipmentListItem {
  id: number;
  cargo_code: string;
  date: string;             // ISO date
  status: number;           // FK id
  status_display: string;
  country_name: string | null;
  customer_name: string | null;
  weight_net: number | null;
  weight_gross: number | null;
  departed_at: string | null;   // ISO datetime
  arrived_at: string | null;
  is_gapy_satys: boolean;
  updated_at: string;
}

export interface IFirmSplit {
  export_firm_id: number;
  export_firm_name: string | null;
  weight_kg: number;
  amount_usd: number | null;
  invoice_number: string | null;
}

export interface IBlockSource {
  block_code: string;
  block_name: string | null;
  weight_kg: number;
}

export interface IStatusLogEntry {
  status_display: string;
  changed_by_name: string;
  changed_at: string;
  comment: string | null;
}

export interface IShipmentComment {
  id: number;
  user_name: string;
  role: string;
  content: string;
  is_system: boolean;
  created_at: string;
}

// ─── Planning ─────────────────────────────────────────────────────────────

export interface IWeeklyHarvestPlan {
  id: number;
  season: number;
  season_name: string;
  block: number;
  block_code: string;
  block_name: string;
  week_number: number;
  year: number;
  monday_plan_kg: number;
  tuesday_plan_kg: number;
  wednesday_plan_kg: number;
  thursday_plan_kg: number;
  friday_plan_kg: number;
  saturday_plan_kg: number;
  monday_actual_kg: number | null;
  tuesday_actual_kg: number | null;
  wednesday_actual_kg: number | null;
  thursday_actual_kg: number | null;
  friday_actual_kg: number | null;
  saturday_actual_kg: number | null;
  total_plan_kg: number;
  total_actual_kg: number | null;
  entered_by_name: string | null;
  updated_at: string;
}

export interface IQuotaAllocation {
  id: number;
  season: number;
  season_name: string;
  export_firm: number;
  export_firm_name: string | null;
  granted_kg: number;
  used_kg: number;
  warning_80_sent: boolean;
  warning_90_sent: boolean;
  warning_95_sent: boolean;
}

export interface IQuotaDashboardItem extends IQuotaAllocation {
  remaining_kg: number;
  used_pct: number;
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

export interface ISalesReport {
  price_per_kg: string | null;
  total_usd: string | null;
  weight_sold_kg: string | null;
  weight_rejected_kg: string | null;
  transport_cost_usd: string | null;
  market_fee_usd: string | null;
  other_expenses_usd: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IOverdueShipment extends IShipmentListItem {
  days_overdue: number;
  has_sales_report: boolean;
}

// ─── Truck Allocations ────────────────────────────────────────────────────

export interface IWeeklyTruckAllocation {
  id: number;
  season: number;
  season_name: string;
  week_number: number;
  year: number;
  day_of_week: number;  // 1=Mon, 6=Sat
  total_planned_kg: number | null;
  total_trucks_calc: number | null;
  russia_trucks: number;
  kazakhstan_trucks: number;
  gapy_satys_trucks: number;
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
}

// ─── Domestic Sales ────────────────────────────────────────────────────────

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

// ─── Advances ─────────────────────────────────────────────────────────────

export interface IAdvanceShipmentLink {
  shipment: number;
  shipment_cargo_code: string;
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

// ─── Admin ─────────────────────────────────────────────────────────────────

export interface ILoadingLocation {
  id: number;
  name: string;
}

export interface ITomatoVariety {
  id: number;
  name: string;
  type: string | null;
  avg_fruit_weight_gr: string | null;
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

export interface ISeason {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
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
}

export interface INotification {
  id: number;
  kind: 'quota_80' | 'quota_90' | 'quota_95' | 'quota_100' | 'overdue';
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// ─── Shipment (detail) ────────────────────────────────────────────────────

export interface IShipmentDetail extends IShipmentListItem {
  status_code: string;
  allowed_transitions: string[];
  box_count: number | null;
  pallet_count: number | null;
  packaging_kg: number | null;
  vehicle_condition: VehicleCondition | null;
  vehicle_condition_note: string | null;
  route_note: string | null;
  price_per_kg: number | null;
  total_amount_usd: number | null;
  loading_started_at: string | null;
  customs_entry_at: string | null;
  customs_exit_at: string | null;
  border_crossed_at: string | null;
  sale_started_at: string | null;
  sale_ended_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  firm_splits: IFirmSplit[];
  block_sources: IBlockSource[];
  status_log: IStatusLogEntry[];
  comments: IShipmentComment[];
  quality: IShipmentQuality | null;
  sales_report: ISalesReport | null;
}
