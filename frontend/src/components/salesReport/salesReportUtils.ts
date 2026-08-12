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

/** Round a money amount to 2 decimals, mirroring the server's per-value quantize. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Gross sales = Σ round(qty × price).
 *
 * The server quantizes EACH line to 0.01 before summing
 * (SalesReportLineItemSerializer.validate → _recompute_totals), so summing the
 * raw products here would drift by cents against the stored total_sales_local.
 */
export function sumLineAmounts(lines: readonly ILineRow[]): number {
  return roundMoney(
    lines.reduce((a, r) => a + roundMoney((r.quantity_kg ?? 0) * (r.price_local ?? 0)), 0),
  );
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
