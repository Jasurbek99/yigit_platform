import type { IDailyBoardResponse } from '@/types';

// Mock for the Daily Harvest Board (Ýük plan we galyndy). Covers the three
// cell states: fully filled, zero/explicit, and empty (no entry yet).
export const MOCK_DAILY_BOARD: IDailyBoardResponse = {
  date: '2026-06-01',
  season: { id: 3, name: '2025-2026' },
  results: [
    {
      block: 1,
      block_code: 'A',
      block_name: 'A blok',
      entry_id: 101,
      entry_date: '2026-06-01',
      yesterday_rest: '27020.00',
      today_plan: '9000.00',
      total: '36020.00',
      note: '',
      entered_at: '2026-06-01T08:15:00+05:00',
      entered_by_name: 'Soltanmyrat',
    },
    {
      block: 2,
      block_code: 'B',
      block_name: 'B blok',
      entry_id: 102,
      entry_date: '2026-06-01',
      yesterday_rest: '0.00',
      today_plan: '0.00',
      total: '0.00',
      note: 'DINE SORT 1 CYKYA.',
      entered_at: '2026-06-01T08:20:00+05:00',
      entered_by_name: 'Soltanmyrat',
    },
    {
      block: 3,
      block_code: 'C',
      block_name: 'C blok',
      entry_id: null,
      entry_date: '2026-06-01',
      yesterday_rest: null,
      today_plan: null,
      total: null,
      note: '',
      entered_at: null,
      entered_by_name: null,
    },
  ],
};
