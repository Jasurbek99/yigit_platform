// ─── Contract types ─────────────────────────────────────────────────────────
//
// Mirrors the ContractListSerializer / ContractDetailSerializer response shapes
// from apps/contracts/serializers.py.

export type ContractStatus = 'active' | 'completed' | 'closed' | 'cancelled';

export interface IContract {
  id: number;
  contract_number: string;

  // Status
  status: ContractStatus;
  status_display: string;

  // Export firm
  export_firm: number | null;
  export_firm_name: string | null;
  export_firm_code: string | null;

  // Import firm
  import_firm: number | null;
  import_firm_name: string | null;

  // Season
  season: number | null;
  season_name: string | null;

  // Terms
  incoterm: string;

  // Planned
  planned_trucks: number;
  planned_quantity_kg: string; // DecimalField returned as string by DRF
  planned_amount_usd: string;

  // Exported (actuals)
  exported_trucks: number;
  exported_quantity_kg: string;
  exported_amount_usd: string;

  // Computed remaining
  trucks_remaining: number;
  quantity_remaining_kg: string;
  amount_remaining_usd: string;

  // Payments
  payment_received_usd: string;
  ostatok_usd: string;

  // Dates
  start_date: string;
  end_date: string | null;
  created_at: string;
}

export interface IContractDetail extends IContract {
  editable_fields: string[];
}

export interface IContractCreatePayload {
  contract_number: string;
  export_firm: number;
  import_firm: number;
  season: number;
  incoterm: string;
  planned_trucks: number;
  planned_quantity_kg: number;
  planned_amount_usd: number;
  start_date: string; // ISO date YYYY-MM-DD
  end_date?: string | null;
  customer?: number | null;
  contract_type?: string | null;
}
