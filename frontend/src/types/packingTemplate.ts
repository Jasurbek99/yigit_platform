// ─── Packing Template types ────────────────────────────────────────────────────
//
// Mirrors PackingTemplateSerializer from apps/export/serializers.py.
// One template = one Excel "gross net" row: whole-truck packing + firm shares.
// Decimal fields arrive as strings from DRF.

export type PackingProductType = 'tomato' | 'pepper';

export interface IPackingShare {
  readonly id?: number;
  share_order?: number;
  net_kg: string | number | null;
  gross_kg: string | number | null;
  box_count: number | null;
  pallet_count: string | number | null;
  pallet_weight_kg: string | number | null;
}

export interface IPackingTemplate {
  readonly id: number;
  name: string;
  product_type: PackingProductType;
  readonly product_type_display: string;
  net_kg: string | null;
  gross_kg: string | null;
  box_count: number | null;
  pallet_count: string | null;
  pallet_weight_kg: string | null;
  shares: IPackingShare[];
  readonly share_count: number;
  is_active: boolean;
  sort_order: number;
}

export interface IPackingTemplatePayload {
  name: string;
  product_type: PackingProductType;
  net_kg?: string | number | null;
  gross_kg?: string | number | null;
  box_count?: number | null;
  pallet_count?: string | number | null;
  pallet_weight_kg?: string | number | null;
  shares?: IPackingShare[];
  is_active?: boolean;
  sort_order?: number;
}
