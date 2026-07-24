/**
 * Raporlar (Hasabatlar) — page-specific mock data (2026).
 *
 * Figures transcribed from the source "Sera Bütçe Yönetimi" app's Raporlar
 * screen. Where a figure is identical to the shared Bütçe dataset (top-line
 * totals, per-block revenue/expense/profit, monthly revenue) the page
 * imports directly from `./seraData` instead of duplicating it here — see
 * `Raporlar.tsx`. Only numbers unique to this screen live in this file:
 * the Bölüm (department) roll-up and the monthly expense figures used by
 * the "Aylık Özet" table / trend charts (these differ slightly from the
 * Bütçe Dashboard's own trend numbers due to upstream rounding).
 */

import { SALES_AMT_BY_CHANNEL } from './seraData';

// ─── Bölüm (department) summary ─────────────────────────────────────────
export interface IDepartmentSummaryRow {
  readonly department: string;
  readonly revenueUsd: number;
  readonly expenseUsd: number;
  readonly profitUsd: number;
}

export const DEPARTMENT_SUMMARY: readonly IDepartmentSummaryRow[] = [
  { department: 'Dusak', revenueUsd: 7005792, expenseUsd: 12204647, profitUsd: -5198855 },
  { department: 'Kaka', revenueUsd: 45822492, expenseUsd: 5111110, profitUsd: 40711382 },
  { department: 'Owadandepe', revenueUsd: 3794772, expenseUsd: 420174, profitUsd: 3374598 },
];

// ─── Monthly summary (Aylık Özet — tüm bloklar toplamı) ─────────────────
export interface IMonthlySummaryRow {
  readonly month: string;
  readonly revenueUsd: number;
  readonly expenseUsd: number;
}

export const MONTHLY_SUMMARY: readonly IMonthlySummaryRow[] = [
  { month: 'Ocak', revenueUsd: 6645118, expenseUsd: 2670168 },
  { month: 'Şubat', revenueUsd: 9815682, expenseUsd: 2471285 },
  { month: 'Mart', revenueUsd: 13052590, expenseUsd: 3104537 },
  { month: 'Nisan', revenueUsd: 15505395, expenseUsd: 3186102 },
  { month: 'Mayıs', revenueUsd: 8668076, expenseUsd: 3291522 },
  { month: 'Haziran', revenueUsd: 2936195, expenseUsd: 2546652 },
  { month: 'Temmuz', revenueUsd: 0, expenseUsd: 452584 },
  { month: 'Ağustos', revenueUsd: 0, expenseUsd: 13080 },
  { month: 'Eylül', revenueUsd: 0, expenseUsd: 0 },
  { month: 'Ekim', revenueUsd: 0, expenseUsd: 0 },
  { month: 'Kasım', revenueUsd: 0, expenseUsd: 0 },
  { month: 'Aralık', revenueUsd: 0, expenseUsd: 0 },
];

// ─── Satış Kanalı Dağılımı (USD Gelir) — pie ────────────────────────────
// Reuses the shared per-channel USD totals (excludes the DTM-denominated
// domestic row, which is not part of the USD pie), relabelled with the
// source app's short city names.
const CHANNEL_LABELS: Record<string, string> = {
  Gazagystan: 'Kazakistan',
  'Russiýa': 'Rusya',
  'Gapy Satyş': 'Kapı',
};

export const CHANNEL_DISTRIBUTION = SALES_AMT_BY_CHANNEL
  .filter((r) => !r.channel.includes('DTM'))
  .map((r) => ({ name: CHANNEL_LABELS[r.channel] ?? r.channel, value: r.total }));

/**
 * Margin %, rounded to 1 decimal — dropping the decimal when it rounds to a
 * whole number (matches the source app's own display rounding, e.g. "%89"
 * instead of "%89,0"). Revenue of 0 always displays as "%0".
 */
export function marginPct(revenueUsd: number, profitUsd: number): { readonly value: number; readonly decimals: 0 | 1 } {
  if (revenueUsd === 0) return { value: 0, decimals: 0 };
  const pct = Math.round((profitUsd / revenueUsd) * 1000) / 10;
  return { value: pct, decimals: pct % 1 === 0 ? 0 : 1 };
}
