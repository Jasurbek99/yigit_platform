// Earliest lifecycle step at which the sales report becomes fillable:
// 4 = yola_chykdy (Departed). System status lags the real sale, so a report
// must be enterable for trucks that have departed (and in practice sold),
// not only once status reaches "Sold" (step 11).
export const MIN_SALES_REPORT_STEP = 4;

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

// category: integer PK (matches ISalesReportExpenseInput.category after Phase 1 breaking change)
// category_code: string code ('OTHER', 'NDS', etc.) used only for UI logic (label_raw input)
export interface IExpenseRow {
  _key: number;
  category: number | null;
  category_code: string;
  label_raw: string;
  amount_local: number | null;
}
