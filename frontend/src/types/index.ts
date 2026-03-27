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

export interface IShipmentDetail extends IShipmentListItem {
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
}
