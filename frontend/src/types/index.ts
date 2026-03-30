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
}

// ─── Reference ────────────────────────────────────────────────────────────

export interface ICountry {
  id: number;
  name_tk: string;
  name_ru: string | null;
  name_en: string | null;
  code: string | null;
}

export interface IExportFirm {
  id: number;
  code: string;
  name_tk: string;
  name_ru: string | null;
  name_en: string | null;
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
