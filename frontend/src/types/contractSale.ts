// ─── Contract Sale types ──────────────────────────────────────────────────────
//
// Mirrors ContractSaleListSerializer / ContractSaleDetailSerializer /
// ContractSaleCreateSerializer from apps/contracts/serializers.py.
// (Was: types/invoice.ts — renamed to remove confusion with invoice documents.)

export type ContractSaleStatus = 'draft' | 'sent' | 'paid' | 'void';

export interface IContractSale {
  id: number;

  // Contract FK
  contract: number | null;
  contract_number: string;

  // Shipment FK
  shipment: number | null;
  shipment_code: string | null;

  // Core fields
  invoice_number: number;
  invoice_date: string; // YYYY-MM-DD
  serial_truck_number: number | null;

  // Export firm FK
  export_firm: number | null;
  export_firm_name: string | null;

  // Import firm FK
  import_firm: number | null;
  import_firm_name: string | null;

  // Terms
  incoterm: string;

  // Money — DecimalField → string from DRF
  quantity_kg: string | null;
  price_per_kg: string | null;
  total_usd: string | null;

  // Document
  passport_sdelka: string;
  scan_uploaded: boolean;

  // Per-firm packing override (null = derived from the truck config; set via the
  // Sheet packing panel). Decimals arrive as strings.
  gross_kg: string | null;
  box_count: number | null;
  pallet_count: string | null;
  pallet_weight_kg: string | null;

  // Status
  status: ContractSaleStatus;
  status_display: string;

  // Audit
  created_at: string;
  updated_at: string;
}

export interface IContractSaleDetail extends IContractSale {
  editable_fields: string[];
}

export interface IContractSaleCreatePayload {
  contract: number;
  invoice_number: number;
  invoice_date: string; // YYYY-MM-DD
  shipment?: number | null;
  serial_truck_number?: number | null;
  export_firm?: number | null;
  import_firm?: number | null;
  incoterm?: string;
  quantity_kg?: number | string | null;
  price_per_kg?: number | string | null;
  total_usd?: number | string | null;
  passport_sdelka?: string;
  scan_uploaded?: boolean;
  status?: ContractSaleStatus;
}

export interface IContractSaleUpdatePayload extends Partial<IContractSaleCreatePayload> {
  // All fields optional for PATCH
}
