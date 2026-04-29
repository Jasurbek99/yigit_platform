import type { IShipmentDraft } from '@/types';
import dayjs from 'dayjs';

// Dates relative to "today" so freshness colours always work in mock mode.
const today = dayjs().format('YYYY-MM-DD');
const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
const twoDaysAgo = dayjs().subtract(2, 'day').format('YYYY-MM-DD');

const todayTs = dayjs().subtract(4, 'hour').toISOString();
const todayTs2 = dayjs().subtract(6, 'hour').toISOString();
const todayTs3 = dayjs().subtract(8, 'hour').toISOString();
const yesterdayTs = dayjs().subtract(1, 'day').subtract(9, 'hour').toISOString();
const oldTs = dayjs().subtract(2, 'day').subtract(11, 'hour').toISOString();

export const MOCK_DRAFTS: IShipmentDraft[] = [
  {
    id: 1001,
    cargo_code: '17AP197/26',
    date: today,
    created_at: todayTs,
    created_by_name: 'Soltanmyrat',
    weight_net: 18500,
    official_export_code: '17|AP|197|A4|26|08',
    previous_platform_id: null,
    harvest_age_days: 0,
    freshness: 'today',
    variety_confidence: 'none',
    block_sources: [
      { block_id: 1, block_code: 'A', weight_kg: 12000 },
      { block_id: 2, block_code: 'B', weight_kg: 4000 },
      { block_id: 3, block_code: 'C', weight_kg: 2500 },
    ],
  },
  {
    id: 1002,
    cargo_code: '17AP198/26',
    date: today,
    created_at: todayTs2,
    created_by_name: 'Soltanmyrat',
    weight_net: 18500,
    official_export_code: null,
    previous_platform_id: null,
    harvest_age_days: 0,
    freshness: 'today',
    variety_confidence: 'none',
    block_sources: [
      { block_id: 4, block_code: 'OWD', weight_kg: 18500 },
    ],
  },
  {
    id: 1003,
    cargo_code: '17AP199/26',
    date: today,
    created_at: todayTs3,
    created_by_name: 'Soltanmyrat',
    weight_net: 18500,
    official_export_code: null,
    previous_platform_id: null,
    harvest_age_days: 0,
    freshness: 'today',
    variety_confidence: 'none',
    block_sources: [
      { block_id: 4, block_code: 'OWD', weight_kg: 13000 },
      { block_id: 8, block_code: 'H', weight_kg: 5500 },
    ],
  },
  {
    id: 1004,
    cargo_code: '17AP196/26',
    date: yesterday,
    created_at: yesterdayTs,
    created_by_name: 'Soltanmyrat',
    weight_net: 18500,
    official_export_code: null,
    previous_platform_id: null,
    harvest_age_days: 1,
    freshness: 'yesterday',
    variety_confidence: 'none',
    block_sources: [
      { block_id: 4, block_code: 'D', weight_kg: 18500 },
    ],
  },
  {
    id: 1005,
    cargo_code: '17AP195/26',
    date: twoDaysAgo,
    created_at: oldTs,
    created_by_name: 'Soltanmyrat',
    weight_net: 18500,
    official_export_code: null,
    previous_platform_id: null,
    harvest_age_days: 2,
    freshness: 'aged',
    variety_confidence: 'none',
    block_sources: [
      { block_id: 5, block_code: 'E', weight_kg: 12000 },
      { block_id: 6, block_code: 'F', weight_kg: 6500 },
    ],
  },
];
