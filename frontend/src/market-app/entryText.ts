// The words of one lot entry, shared by its row, the delete sheet and the toasts (artifact saleText / costRow).
import i18n from '@/i18n';
import { boxes, kg, money } from './format';
import type { LotEntry } from './lotEntries';
import type { IDebtSale, ISale } from './types';

/** «12 ящиков, 80,5 кг» / «2 паллеты (100 ящиков), …» / «Вся машина (68 ящиков), …». */
export function saleWhat(sale: ISale): string {
  let what = boxes(sale.boxes);
  if (sale.unit === 'pallet') {
    what = i18n.t('market.lot.sale_pallets', { pallets: i18n.t('market.fmt.pallets', { count: sale.qty }), boxes: what });
  }
  if (sale.unit === 'truck') what = i18n.t('market.lot.whole_truck', { boxes: what });
  return Number(sale.net_kg) > 0 ? `${what}, ${i18n.t('market.lot.kg_value', { v: kg(sale.net_kg) })}` : what;
}

/** A sale in the debts list: «20 ящиков, 130 кг» / «Вся машина (68 ящиков)»; no pallet count (not sent). */
export function debtSaleWhat(sale: IDebtSale): string {
  const count = boxes(sale.boxes);
  const what = sale.unit === 'truck' ? i18n.t('market.lot.whole_truck', { boxes: count }) : count;
  return Number(sale.net_kg) > 0 ? `${what}, ${i18n.t('market.lot.kg_value', { v: kg(sale.net_kg) })}` : what;
}

/** «3 ящика, 30 кг» — parts that are zero are left out. */
export function spoiledAmount(boxCount: number, netKg: string): string {
  return [boxCount > 0 ? boxes(boxCount) : '', Number(netKg) > 0 ? i18n.t('market.lot.kg_value', { v: kg(netKg) }) : '']
    .filter(Boolean).join(', ');
}

/** The entry as one line: «<what>, <sum>» / «Испорчено: …» / «Расход: <name>, <sum>». */
export function entryText(entry: LotEntry, currency: string, categoryLabel: (code: string) => string): string {
  if (entry.kind === 'sale') return `${saleWhat(entry.item)}, ${money(entry.item.total, currency)}`;
  if (entry.kind === 'spoilage') {
    return i18n.t('market.lot.spoiled_row', { v: spoiledAmount(entry.item.boxes, entry.item.net_kg) });
  }
  const name = entry.item.label || categoryLabel(entry.item.category_code);
  return `${i18n.t('market.lot.expense_row', { name })}, ${money(entry.item.amount, currency)}`;
}
