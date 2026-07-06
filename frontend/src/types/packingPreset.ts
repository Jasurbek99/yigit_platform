// ─── Packing Preset types ──────────────────────────────────────────────────────
//
// Mirrors PackingPresetSerializer from apps/export/serializers.py.
// Decimal fields (net_kg, gross_kg, pallet_count, pallet_weight_kg) arrive as
// strings from DRF — parse with parseFloat before passing to InputNumber.

export type PackingProductType = 'tomato' | 'pepper';

export interface IPackingPreset {
  readonly id: number;
  readonly name: string;
  readonly product_type: PackingProductType;
  readonly product_type_display: string;
  /** DecimalField — arrives as string */
  readonly net_kg: string;
  /** DecimalField — arrives as string */
  readonly gross_kg: string;
  /** Integer */
  readonly box_count: number;
  /** DecimalField — arrives as string (e.g. "16.5") */
  readonly pallet_count: string;
  /** DecimalField — arrives as string */
  readonly pallet_weight_kg: string;
  readonly is_active: boolean;
  readonly sort_order: number;
}

export interface IPackingPresetCreatePayload {
  name: string;
  product_type: PackingProductType;
  net_kg: number | string;
  gross_kg: number | string;
  box_count: number;
  pallet_count: number | string;
  pallet_weight_kg: number | string;
  is_active?: boolean;
  sort_order?: number;
}

export interface IPackingPresetUpdatePayload extends Partial<IPackingPresetCreatePayload> {
  // All fields optional for PATCH
}
