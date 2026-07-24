/**
 * Personel & Maaşlar — page-specific mock data (2026).
 *
 * The per-block headcount list reuses the shared `SERA_BLOCKS_BY_GROUP`
 * dataset (same block names/areas as the Bütçe Dashboard) — this file only
 * holds the figures unique to this screen: the Dolandyryş (admin-only) row,
 * the per-person monthly cost table, and foreign-worker salaries.
 */

// ─── Dolandyryş (admin) — headcount only, excluded from production math ───
export const ADMIN_BLOCK = {
  name: 'Dolandyryş',
  note: 'Yalnız personel sayısı — üretim/gübre/alan hesaplarına dahil değildir',
} as const;

// ─── Adam Başına Aylık Çykdajy (per-person monthly cost, 12 months) ───────
export interface MonthlyStaffCostRow {
  readonly label: string;
  readonly months: readonly number[];
}

export const MONTHLY_STAFF_COST_ROWS: readonly MonthlyStaffCostRow[] = [
  { label: 'Işgärleri gatnatmak çykdajylary', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: 'Işgärleriň saglygy boýunça çykdajylar', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
];

// ─── Daşary Ýurt Işgärleri (foreign workers, annual salary in USD) ────────
export interface ForeignStaffRow {
  readonly country: string;
  readonly annualSalaryUsd: number;
}

export const FOREIGN_STAFF: readonly ForeignStaffRow[] = [
  { country: 'Kazakistan', annualSalaryUsd: 1000 },
  { country: 'Rusya', annualSalaryUsd: 0 },
];
