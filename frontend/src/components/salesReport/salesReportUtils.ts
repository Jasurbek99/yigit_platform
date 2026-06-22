import type { SalesReportExpenseCategory } from '@/types';

// Earliest lifecycle step at which the sales report becomes fillable:
// 4 = yola_chykdy (Departed). System status lags the real sale, so a report
// must be enterable for trucks that have departed (and in practice sold),
// not only once status reaches "Sold" (step 11).
export const MIN_SALES_REPORT_STEP = 4;

export const EXPENSE_CATEGORIES: SalesReportExpenseCategory[] = [
  'TOM_ROSHOD',
  'NAKLIYE',
  'BAZAR_ROSHOD',
  'INTERES',
  'UZBEK_FURA_AWANS',
  'DOZWOL',
  'ANALIZ',
  'PROSTOY',
  'PERESEPKA',
  'ARAP',
  'KASPIY_KOMIS',
  'UZBEK_FURA_SOLYARKA',
  'NDS',
  'SBOR',
  'UZB_KAZ_POST',
  'UZB_KAZ_NAKLIYE',
  'UZBEK_TAM',
  'MOI',
  'DOSMOTR',
  'PEREWOT',
  'OTHER',
];

export function fmtLocal(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Row types shared across sub-components ──────────────────────────────────

export interface ILineRow {
  _key: number;
  product_name: string;
  quantity_kg: number | null;
  price_local: number | null;
}

export interface IExpenseRow {
  _key: number;
  category: SalesReportExpenseCategory | null;
  label_raw: string;
  amount_local: number | null;
}
