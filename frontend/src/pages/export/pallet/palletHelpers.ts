import type { IPallet, IWeightmasterPreviewRow } from '@/types';

export function computeNet(
  gross: number,
  crateWeightKg: number,
  crateCount: number,
  palletKg: number,
  additionsKg: number,
): number {
  return gross - crateWeightKg * crateCount - palletKg - additionsKg;
}

/**
 * Editable row mirrors IPallet but coerces decimal-string weight fields to
 * numbers so computeNet stays typesafe and InputNumber binds correctly.
 */
export interface IEditableRow {
  key: number;
  pallet_number: number;
  crate_type: number;
  crate_type_name: string;
  crate_count: number;
  gross_weight_kg: number;
  pallet_weight_kg: number;
  additions_kg: number;
  variety: number;
  variety_name: string;
  sub_block: number;
  sub_block_code: string;
  loaded_at?: string;
}

/**
 * Converts a weightmaster import preview row into an editable grid row.
 * Unresolved FKs (null crate/variety/block) become 0 so the Select renders as
 * "unset" and the user picks the right value before saving.
 */
export function weightmasterRowToEditableRow(r: IWeightmasterPreviewRow): IEditableRow {
  return {
    key:              r.pallet_number,
    pallet_number:    r.pallet_number,
    crate_type:       r.crate_type ?? 0,
    crate_type_name:  r.crate_type_name,
    crate_count:      r.crate_count,
    gross_weight_kg:  Number(r.gross_weight_kg),
    pallet_weight_kg: Number(r.pallet_weight_kg),
    additions_kg:     Number(r.additions_kg),
    variety:          r.variety ?? 0,
    variety_name:     r.variety_name,
    sub_block:        r.sub_block ?? 0,
    sub_block_code:   r.sub_block_code,
  };
}

export function palletToEditableRow(p: IPallet): IEditableRow {
  return {
    key:              p.pallet_number,
    pallet_number:    p.pallet_number,
    crate_type:       p.crate_type,
    crate_type_name:  p.crate_type_name,
    crate_count:      p.crate_count,
    gross_weight_kg:  Number(p.gross_weight_kg),
    pallet_weight_kg: Number(p.pallet_weight_kg),
    additions_kg:     Number(p.additions_kg),
    variety:          p.variety,
    variety_name:     p.variety_name,
    sub_block:        p.sub_block,
    sub_block_code:   p.sub_block_code,
    loaded_at:        p.loaded_at,
  };
}
