import type { IPallet } from '@/types';

// ─── Mock pallets — real data from 10AP116_CEKIM_GAPAN.xlsx ──────────────
// 15 pallets from the actual shipment (first 15 of 33).
// Net formula: gross - (crate_weight_kg × count) - pallet_kg - additions_kg
// LEBIZ PLAST 18 crate weight = 0.543 kg each.
//
// IDs reference mock varieties: variety 2 = Midelice (id:2), variety 8 = Redity (id:8)
// Sub-blocks reference mock blocks:  sub_block 101 = F1 (id:101), 102 = F2 (id:102)

export const MOCK_PALLETS: IPallet[] = [
  {
    id: 1, shipment: 1, pallet_number: 1,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 64, gross_weight_kg: '474.00', pallet_weight_kg: '7.50', additions_kg: '4.00',
    net_weight_kg: '427.75',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T06:00:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 2, shipment: 1, pallet_number: 2,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 64, gross_weight_kg: '469.00', pallet_weight_kg: '8.00', additions_kg: '4.00',
    net_weight_kg: '422.25',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T06:05:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 3, shipment: 1, pallet_number: 3,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 64, gross_weight_kg: '490.00', pallet_weight_kg: '8.50', additions_kg: '4.00',
    net_weight_kg: '442.75',
    variety: 8, variety_code: '08', variety_name: 'Redity',
    sub_block: 101, sub_block_code: 'F1',
    loaded_at: '2026-04-11T06:10:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 4, shipment: 1, pallet_number: 4,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 72, gross_weight_kg: '549.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '499.90',
    variety: 8, variety_code: '08', variety_name: 'Redity',
    sub_block: 101, sub_block_code: 'F1',
    loaded_at: '2026-04-11T06:15:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 5, shipment: 1, pallet_number: 5,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 72, gross_weight_kg: '547.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '497.90',
    variety: 8, variety_code: '08', variety_name: 'Redity',
    sub_block: 101, sub_block_code: 'F1',
    loaded_at: '2026-04-11T06:20:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 6, shipment: 1, pallet_number: 6,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 72, gross_weight_kg: '548.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '498.90',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T06:25:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 7, shipment: 1, pallet_number: 7,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 72, gross_weight_kg: '538.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '488.90',
    variety: 8, variety_code: '08', variety_name: 'Redity',
    sub_block: 101, sub_block_code: 'F1',
    loaded_at: '2026-04-11T06:30:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 8, shipment: 1, pallet_number: 8,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 72, gross_weight_kg: '549.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '499.90',
    variety: 8, variety_code: '08', variety_name: 'Redity',
    sub_block: 101, sub_block_code: 'F1',
    loaded_at: '2026-04-11T06:35:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 9, shipment: 1, pallet_number: 9,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 72, gross_weight_kg: '534.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '484.90',
    variety: 8, variety_code: '08', variety_name: 'Redity',
    sub_block: 101, sub_block_code: 'F1',
    loaded_at: '2026-04-11T06:40:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 10, shipment: 1, pallet_number: 10,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 88, gross_weight_kg: '664.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '606.22',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T06:45:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 11, shipment: 1, pallet_number: 11,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 88, gross_weight_kg: '656.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '598.22',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T06:50:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 12, shipment: 1, pallet_number: 12,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 88, gross_weight_kg: '657.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '599.22',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T06:55:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 13, shipment: 1, pallet_number: 13,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 88, gross_weight_kg: '655.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '597.22',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T07:00:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 14, shipment: 1, pallet_number: 14,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 88, gross_weight_kg: '648.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '590.22',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T07:05:00+05:00', created_by_name: 'Artykow Maksat',
  },
  {
    id: 15, shipment: 1, pallet_number: 15,
    crate_type: 1, crate_type_name: 'LEBIZ PLAST 18', crate_type_weight_kg: '0.543',
    crate_count: 88, gross_weight_kg: '662.00', pallet_weight_kg: '6.00', additions_kg: '4.00',
    net_weight_kg: '604.22',
    variety: 2, variety_code: '02', variety_name: 'Midelice',
    sub_block: 102, sub_block_code: 'F2',
    loaded_at: '2026-04-11T07:10:00+05:00', created_by_name: 'Artykow Maksat',
  },
];

export const MOCK_CRATE_TYPES = [
  { id: 1, name: 'LEBIZ PLAST 18', weight_kg: '0.543', is_active: true },
  { id: 2, name: 'AGAÇ', weight_kg: '0.800', is_active: false },
  { id: 3, name: 'PLASMAS', weight_kg: '0.600', is_active: false },
];
