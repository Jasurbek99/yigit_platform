// ─── Invoice types ───────────────────────────────────────────────────────────
//
// Mirrors InvoiceListSerializer / InvoiceDetailSerializer / InvoiceCreateSerializer
// from apps/contracts/serializers.py.

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

export interface IInvoice {
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

  // Status
  status: InvoiceStatus;
  status_display: string;

  // Audit
  created_at: string;
  updated_at: string;
}

export interface IInvoiceDetail extends IInvoice {
  editable_fields: string[];
}

export interface IInvoiceCreatePayload {
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
  status?: InvoiceStatus;
}

export interface IInvoiceUpdatePayload extends Partial<IInvoiceCreatePayload> {
  // All fields optional for PATCH
}
