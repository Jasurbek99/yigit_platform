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
