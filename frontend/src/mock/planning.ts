import type {
  IWeeklyHarvestPlan,
  IQuotaDashboardItem,
  IPriceEntry,
  IWeeklyTruckAllocation,
  IBlockSummary,
  IDomesticSale,
} from '@/types';

export const MOCK_HARVEST_PLANS: IWeeklyHarvestPlan[] = [
  {
    id: 1, season: 1, season_name: '2025-2026', block: 1, block_code: 'A', block_name: 'A-Ýyladyşhana',
    week_number: 8, year: 2025,
    monday_plan_kg: 3200, tuesday_plan_kg: 3200, wednesday_plan_kg: 3000,
    thursday_plan_kg: 3200, friday_plan_kg: 3100, saturday_plan_kg: 2800,
    monday_actual_kg: 3150, tuesday_actual_kg: 3280, wednesday_actual_kg: 2950,
    thursday_actual_kg: null, friday_actual_kg: null, saturday_actual_kg: null,
    total_plan_kg: 18500, total_actual_kg: 9380,
    status: 'approved', submitted_at: '2025-02-14T08:00:00+05:00', submitted_by_name: 'toyly_b',
    approved_at: '2025-02-14T12:00:00+05:00', approved_by_name: 'Gadam',
    rejected_at: null, rejected_by_name: null, rejection_note: null,
    entered_by_name: 'toyly_b', updated_at: '2025-02-17T08:00:00+05:00',
  },
  {
    id: 2, season: 1, season_name: '2025-2026', block: 2, block_code: 'B', block_name: 'B-Ýyladyşhana',
    week_number: 8, year: 2025,
    monday_plan_kg: 3500, tuesday_plan_kg: 3500, wednesday_plan_kg: 3200,
    thursday_plan_kg: 3500, friday_plan_kg: 3300, saturday_plan_kg: 3000,
    monday_actual_kg: 3600, tuesday_actual_kg: 3450, wednesday_actual_kg: 3250,
    thursday_actual_kg: null, friday_actual_kg: null, saturday_actual_kg: null,
    total_plan_kg: 20000, total_actual_kg: 10300,
    status: 'submitted', submitted_at: '2025-02-15T09:00:00+05:00', submitted_by_name: 'guwanc_k',
    approved_at: null, approved_by_name: null,
    rejected_at: null, rejected_by_name: null, rejection_note: null,
    entered_by_name: 'guwanc_k', updated_at: '2025-02-17T08:00:00+05:00',
  },
  {
    id: 3, season: 1, season_name: '2025-2026', block: 3, block_code: 'C', block_name: 'C-Ýyladyşhana',
    week_number: 8, year: 2025,
    monday_plan_kg: 2800, tuesday_plan_kg: 2800, wednesday_plan_kg: 2600,
    thursday_plan_kg: 2800, friday_plan_kg: 2700, saturday_plan_kg: 2500,
    monday_actual_kg: null, tuesday_actual_kg: null, wednesday_actual_kg: null,
    thursday_actual_kg: null, friday_actual_kg: null, saturday_actual_kg: null,
    total_plan_kg: 16200, total_actual_kg: null,
    status: 'rejected', submitted_at: '2025-02-14T10:00:00+05:00', submitted_by_name: 'geldimyrat_a',
    approved_at: null, approved_by_name: null,
    rejected_at: '2025-02-15T11:00:00+05:00', rejected_by_name: 'Gadam',
    rejection_note: 'Plan values too low for block C capacity',
    entered_by_name: 'geldimyrat_a', updated_at: '2025-02-16T10:00:00+05:00',
  },
];

export const MOCK_QUOTA_DASHBOARD: IQuotaDashboardItem[] = [
  { id: 1, season: 1, season_name: '2025-2026', export_firm: 1, export_firm_name: 'YGT H.J.', granted_kg: 500000, used_kg: 312000, remaining_kg: 188000, used_pct: 62.4, warning_80_sent: false, warning_90_sent: false, warning_95_sent: false },
  { id: 2, season: 1, season_name: '2025-2026', export_firm: 2, export_firm_name: 'Gök Mäkan', granted_kg: 300000, used_kg: 255000, remaining_kg: 45000, used_pct: 85.0, warning_80_sent: true, warning_90_sent: false, warning_95_sent: false },
  { id: 3, season: 1, season_name: '2025-2026', export_firm: 3, export_firm_name: 'Altyn Asyr', granted_kg: 200000, used_kg: 194000, remaining_kg: 6000, used_pct: 97.0, warning_80_sent: true, warning_90_sent: true, warning_95_sent: true },
  { id: 4, season: 1, season_name: '2025-2026', export_firm: 4, export_firm_name: 'Türkmen Eksport', granted_kg: 150000, used_kg: 48000, remaining_kg: 102000, used_pct: 32.0, warning_80_sent: false, warning_90_sent: false, warning_95_sent: false },
  { id: 5, season: 1, season_name: '2025-2026', export_firm: 5, export_firm_name: 'Gündogar', granted_kg: 250000, used_kg: 201000, remaining_kg: 49000, used_pct: 80.4, warning_80_sent: true, warning_90_sent: false, warning_95_sent: false },
];

export const MOCK_TRUCK_ALLOCATIONS: IWeeklyTruckAllocation[] = [
  { id: 1, season: 1, season_name: '2025-2026', week_number: 13, year: 2026, day_of_week: 1, total_planned_kg: 111000, total_trucks_calc: 6.0, russia_trucks: 3, kazakhstan_trucks: 2, gapy_satys_trucks: 1, decided_by_name: 'Gadam', created_at: '2026-03-24T08:00:00+05:00' },
  { id: 2, season: 1, season_name: '2025-2026', week_number: 13, year: 2026, day_of_week: 2, total_planned_kg: 95000, total_trucks_calc: 5.1, russia_trucks: 2, kazakhstan_trucks: 3, gapy_satys_trucks: 0, decided_by_name: 'Gadam', created_at: '2026-03-24T08:00:00+05:00' },
  { id: 3, season: 1, season_name: '2025-2026', week_number: 13, year: 2026, day_of_week: 3, total_planned_kg: 120500, total_trucks_calc: 6.5, russia_trucks: 4, kazakhstan_trucks: 2, gapy_satys_trucks: 1, decided_by_name: 'Gadam', created_at: '2026-03-24T08:00:00+05:00' },
  { id: 4, season: 1, season_name: '2025-2026', week_number: 13, year: 2026, day_of_week: 4, total_planned_kg: 102000, total_trucks_calc: 5.5, russia_trucks: 3, kazakhstan_trucks: 2, gapy_satys_trucks: 0, decided_by_name: null, created_at: '2026-03-24T08:00:00+05:00' },
  { id: 5, season: 1, season_name: '2025-2026', week_number: 13, year: 2026, day_of_week: 5, total_planned_kg: 87000, total_trucks_calc: 4.7, russia_trucks: 2, kazakhstan_trucks: 2, gapy_satys_trucks: 1, decided_by_name: 'Gadam', created_at: '2026-03-24T08:00:00+05:00' },
  { id: 6, season: 1, season_name: '2025-2026', week_number: 13, year: 2026, day_of_week: 6, total_planned_kg: null, total_trucks_calc: null, russia_trucks: 0, kazakhstan_trucks: 0, gapy_satys_trucks: 0, decided_by_name: null, created_at: '2026-03-24T08:00:00+05:00' },
];

export const MOCK_BLOCK_SUMMARY: IBlockSummary[] = [
  { block_id: 1, block_code: 'A', block_name: 'A-Ýyladyşhana', total_plan_kg: 18500, total_actual_kg: 17900, deficit_kg: -600 },
  { block_id: 2, block_code: 'B', block_name: 'B-Ýyladyşhana', total_plan_kg: 20000, total_actual_kg: 20450, deficit_kg: 450 },
  { block_id: 3, block_code: 'C', block_name: 'C-Ýyladyşhana', total_plan_kg: 16200, total_actual_kg: 15800, deficit_kg: -400 },
  { block_id: 4, block_code: 'D', block_name: 'D-Ýyladyşhana', total_plan_kg: 22000, total_actual_kg: 22000, deficit_kg: 0 },
  { block_id: 5, block_code: 'E', block_name: 'E-Ýyladyşhana', total_plan_kg: 19500, total_actual_kg: 18100, deficit_kg: -1400 },
  { block_id: 6, block_code: 'F', block_name: 'F-Ýyladyşhana', total_plan_kg: 17000, total_actual_kg: 17600, deficit_kg: 600 },
  { block_id: 7, block_code: 'G', block_name: 'G-Ýyladyşhana', total_plan_kg: 21000, total_actual_kg: 19500, deficit_kg: -1500 },
  { block_id: 8, block_code: 'H', block_name: 'H-Ýyladyşhana', total_plan_kg: 15000, total_actual_kg: 15200, deficit_kg: 200 },
];

export const MOCK_DOMESTIC_SALES: IDomesticSale[] = [
  { id: 1, date: '2026-03-20', buyer: 1, buyer_name: 'Oraz', block: 1, block_code: 'A', block_name: 'A-Ýyladyşhana', export_firm: null, export_firm_name: null, weight_kg: 450, variety: 'gulpakly', price_per_kg: 3.5, tabel_no: 'T-001', notes: null, created_by_name: 'Gadam', created_at: '2026-03-20T09:00:00+05:00' },
  { id: 2, date: '2026-03-20', buyer: 2, buyer_name: 'Bägül', block: 2, block_code: 'B', block_name: 'B-Ýyladyşhana', export_firm: null, export_firm_name: null, weight_kg: 800, variety: 'cherry', price_per_kg: 4.2, tabel_no: 'T-002', notes: 'Premium grade', created_by_name: 'Gadam', created_at: '2026-03-20T10:30:00+05:00' },
  { id: 3, date: '2026-03-21', buyer: 3, buyer_name: 'Merdan', block: 3, block_code: 'C', block_name: 'C-Ýyladyşhana', export_firm: null, export_firm_name: null, weight_kg: 320, variety: 'gulpakly', price_per_kg: 3.5, tabel_no: 'T-003', notes: null, created_by_name: 'Gadam', created_at: '2026-03-21T08:00:00+05:00' },
  { id: 4, date: '2026-03-22', buyer: 4, buyer_name: 'Aýna', block: 5, block_code: 'E', block_name: 'E-Ýyladyşhana', export_firm: null, export_firm_name: null, weight_kg: 100, variety: null, price_per_kg: null, tabel_no: null, notes: 'Bazar üçin', created_by_name: 'Gadam', created_at: '2026-03-22T11:00:00+05:00' },
  { id: 5, date: '2026-03-23', buyer: 5, buyer_name: 'Döwran', block: 7, block_code: 'G', block_name: 'G-Ýyladyşhana', export_firm: null, export_firm_name: null, weight_kg: 600, variety: 'cherry', price_per_kg: 4.0, tabel_no: 'T-005', notes: null, created_by_name: 'Gadam', created_at: '2026-03-23T09:30:00+05:00' },
];

export const MOCK_PRICE_ENTRIES: IPriceEntry[] = [
  { id: 1, date: '2025-02-17', city: 1, city_name: 'Almaty', price_local: 420, price_usd: 0.95, currency: 'KZT', source: 'market', entered_by_name: 'sales_rep', created_at: '2025-02-17T10:00:00+05:00' },
  { id: 2, date: '2025-02-17', city: 2, city_name: 'Astana', price_local: 410, price_usd: 0.93, currency: 'KZT', source: 'market', entered_by_name: 'sales_rep', created_at: '2025-02-17T10:00:00+05:00' },
  { id: 3, date: '2025-02-17', city: 3, city_name: 'Moscow', price_local: 95, price_usd: 1.05, currency: 'RUB', source: 'market', entered_by_name: 'sales_rep', created_at: '2025-02-17T10:00:00+05:00' },
  { id: 4, date: '2025-02-16', city: 1, city_name: 'Almaty', price_local: 415, price_usd: 0.94, currency: 'KZT', source: 'market', entered_by_name: 'sales_rep', created_at: '2025-02-16T10:00:00+05:00' },
  { id: 5, date: '2025-02-16', city: 2, city_name: 'Astana', price_local: 405, price_usd: 0.92, currency: 'KZT', source: 'market', entered_by_name: 'sales_rep', created_at: '2025-02-16T10:00:00+05:00' },
  { id: 6, date: '2025-02-16', city: 3, city_name: 'Moscow', price_local: 92, price_usd: 1.02, currency: 'RUB', source: 'market', entered_by_name: 'sales_rep', created_at: '2025-02-16T10:00:00+05:00' },
  { id: 7, date: '2025-02-15', city: 1, city_name: 'Almaty', price_local: 408, price_usd: 0.92, currency: 'KZT', source: 'market', entered_by_name: 'sales_rep', created_at: '2025-02-15T10:00:00+05:00' },
];
