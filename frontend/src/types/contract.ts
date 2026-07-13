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
  // Buyer destination country code (detail only) — gates the KZ contract generator.
  import_firm_country_code?: string | null;
  // The buyer firm's director name (detail only) — the generator modal pre-fills
  // its director field from this.
  import_firm_director?: string | null;

  // Season
  season: number | null;
  season_name: string | null;

  // Type + deal passport
  contract_type: 'FRAMEWORK' | 'ONE_TIME';
  passport_sdelka: string;

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

  // Invoice tracking
  last_invoice_number: number | null;

  // Dates
  start_date: string;
  end_date: string | null;
  created_at: string;
}

export interface IContractAttachment {
  id: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number;
  uploaded_by_name: string;
  uploaded_at: string;
}

export interface IContractDetail extends IContract {
  editable_fields: string[];
  attachments: IContractAttachment[];
}

export interface IContractCreatePayload {
  // Optional — the backend auto-generates a per-seller/per-year number when blank.
  contract_number?: string;
  export_firm: number;
  import_firm: number;
  // Optional — defaults server-side to the active season.
  season?: number;
  passport_sdelka?: string;
  incoterm: string;
  planned_trucks: number;
  planned_quantity_kg: number;
  planned_amount_usd: number;
  start_date: string; // ISO date YYYY-MM-DD
  end_date?: string | null;
  customer?: number | null;
  contract_type?: string | null;
}

// ─── Shipment firm-split ↔ contract bridge (Slice 4) ─────────────────────────

export interface IFrameworkOption {
  id: number;
  contract_number: string;
}

export interface ILinkedContract {
  contract_id: number;
  contract_number: string;
  contract_type: 'FRAMEWORK' | 'ONE_TIME';
}

export interface IShipmentFirmContractRow {
  export_firm: number;
  export_firm_code: string;
  export_firm_name: string;
  weight_kg: string | null;
  amount_usd: string | null;
  money_warning: 'bank' | 'cash' | null;
  framework_options: IFrameworkOption[];
  linked: ILinkedContract | null;
}

export interface IShipmentFirmContracts {
  shipment: number;
  import_firm: number | null;
  import_firm_name: string | null;
  rows: IShipmentFirmContractRow[];
}
