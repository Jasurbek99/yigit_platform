// A lot's sales, spoilage and expenses as one list, newest first, grouped by local day (study §3.4).
import { dayKey } from './dates';
import type { IExpense, ILotDetail, ISale, ISpoilage } from './types';

export type LotEntry =
  | { kind: 'sale'; at: string; item: ISale }
  | { kind: 'spoilage'; at: string; item: ISpoilage }
  | { kind: 'expense'; at: string; item: IExpense };

/** One selling day: its entries and the money / kg of its sales and expenses. */
export interface IDayGroup {
  key: string;
  at: string;
  entries: LotEntry[];
  sales: number;
  cost: number;
  kg: number;
}

/** Client-side sums to the cent, so float drift never shows as «0,00000001». */
export function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

/** React key: ids repeat across the three tables. */
export function entryKey(e: LotEntry): string {
  return `${e.kind}-${e.item.id}`;
}

export function lotEntries(lot: ILotDetail): LotEntry[] {
  const all: LotEntry[] = [
    ...lot.sales.map((item): LotEntry => ({ kind: 'sale', at: item.sold_at, item })),
    ...lot.spoilage.map((item): LotEntry => ({ kind: 'spoilage', at: item.recorded_at, item })),
    ...lot.expenses.map((item): LotEntry => ({ kind: 'expense', at: item.recorded_at, item })),
  ];
  return all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function groupByDay(entries: LotEntry[]): IDayGroup[] {
  const days: IDayGroup[] = [];
  for (const e of entries) {
    const key = dayKey(e.at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, at: e.at, entries: [], sales: 0, cost: 0, kg: 0 };
      days.push(day);
    }
    day.entries.push(e);
    if (e.kind === 'sale') {
      day.sales = cents(day.sales + Number(e.item.total));
      day.kg = cents(day.kg + Number(e.item.net_kg));
    } else if (e.kind === 'expense') {
      day.cost = cents(day.cost + Number(e.item.amount));
    }
  }
  return days;
}

/** What a sale's typed total differs from price × net kg; 0 when there is no formula. */
export function saleDiff(sale: ISale): number {
  return Number(sale.calc_total) > 0 ? cents(Number(sale.total) - Number(sale.calc_total)) : 0;
}

/** «Разница с формулой»: Σ(total − calc) over the lot's sales. */
export function formulaDiff(sales: ISale[]): number {
  return cents(sales.reduce((sum, s) => sum + saleDiff(s), 0));
}
