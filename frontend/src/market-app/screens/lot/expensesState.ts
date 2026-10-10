// The expenses sheet's pure logic (artifact `costSheet`; study §3.8). The server re-checks every row.
import i18n from '@/i18n';
import { groupThousands, money, parseDecimal } from '../../format';
import { cents } from '../../lotEntries';
import type { IExpense, IExpenseCategory, IExpenseRowInput } from '../../types';

/** backend apps/market/expense_codes.py OTHER_CODE: the only category that needs a name. */
export const OTHER_CODE = 'OTHER';
/** amount is DecimalField(max_digits=12, decimal_places=2): at most 10 whole digits. */
const MAX_AMOUNT = 1e10;

/** The sheet as typed: an amount per category id, and the name of the «Другое» row. */
export interface ICostForm {
  amounts: Readonly<Record<number, string>>;
  otherName: string;
}

/** The named rows in market order, and «Другое» (with its own name field) last. */
export interface ICostRows {
  named: IExpenseCategory[];
  other: IExpenseCategory | null;
}

export type CostCheck =
  | { ok: false; error: string; focusId: string }
  | { ok: true; rows: IExpenseRowInput[] };

export function costRows(categories: IExpenseCategory[]): ICostRows {
  return {
    named: categories.filter((c) => c.code !== OTHER_CODE),
    other: categories.find((c) => c.code === OTHER_CODE) ?? null,
  };
}

export const amountId = (c: IExpenseCategory): string => `mk-cost-${c.id}`;
export const OTHER_NAME_ID = 'mk-cost-name';

/** A typed amount, thousands spaced; null when it would not fit the server's column (keep the old text). */
export function typedAmount(raw: string): string | null {
  const next = groupThousands(raw, 2);
  return (parseDecimal(next) ?? 0) < MAX_AMOUNT ? next : null;
}

/** The rows with an amount above 0, in sheet order. */
function filled(rows: ICostRows, form: ICostForm): Array<{ c: IExpenseCategory; v: number }> {
  const all = rows.other ? [...rows.named, rows.other] : rows.named;
  return all.map((c) => ({ c, v: parseDecimal(form.amounts[c.id] ?? '') ?? 0 })).filter((x) => x.v > 0);
}

/** «Всего расходов»: the sum of the filled rows, to the cent. */
export function costSum(rows: ICostRows, form: ICostForm): number {
  return cents(filled(rows, form).reduce((sum, x) => sum + x.v, 0));
}

/** «Напишите хотя бы одну сумму.», «Напишите название расхода.», or the request rows. */
export function checkCosts(rows: ICostRows, form: ICostForm): CostCheck {
  const list = filled(rows, form);
  if (list.length === 0) {
    const first = rows.named[0] ?? rows.other;
    return { ok: false, error: i18n.t('market.costs.need_any'), focusId: first ? amountId(first) : '' };
  }
  const name = form.otherName.trim();
  if (list.some((x) => x.c.code === OTHER_CODE) && !name) {
    return { ok: false, error: i18n.t('market.costs.need_name'), focusId: OTHER_NAME_ID };
  }
  return {
    ok: true,
    rows: list.map(({ c, v }) => (c.code === OTHER_CODE
      ? { category_id: c.id, amount: v.toFixed(2), label: name }
      : { category_id: c.id, amount: v.toFixed(2) })),
  };
}

/** «Расход: Комиссия, 5 000 ₸» for one row, «Расходы: 3 записи, 12 000 ₸» for more. */
export function costsToast(entries: IExpense[], currency: string, categoryLabel: (code: string) => string): string {
  const total = money(cents(entries.reduce((sum, e) => sum + Number(e.amount), 0)), currency);
  if (entries.length === 1) {
    const [e] = entries;
    return i18n.t('market.costs.saved_single', { name: e.label || categoryLabel(e.category_code), total });
  }
  return i18n.t('market.costs.saved_batch', { count: entries.length, total });
}
