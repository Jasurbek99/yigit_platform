// The sell form's pure logic (artifact `formBoxes`, `formWeight`, `updateForm`; study §3.5).
// Everything here is a preview: the server re-checks stock, weight and price under the lot lock.
import i18n from '@/i18n';
import { boxes, inputNumber, int, kg, money, netKg, parseDecimal, signedMoney } from '../../format';
import type { ILot, ILotDetail, SaleUnit } from '../../types';

/** What the lot has for the form: boxes left, boxes per pallet, grams per empty box. */
export interface ILotStock {
  left: number;
  perPallet: number;
  tareG: number;
}

/** The form as typed. Numbers stay strings ("104,5") until the request is built. */
export interface ISellForm {
  unit: SaleUnit;
  /** Digits only; '' while the seller retypes it (the minimum comes back on blur). */
  qty: string;
  /** The count was cut down to the maximum — show the amber hint. */
  capped: boolean;
  gross: string;
  price: string;
  total: string;
  /** The seller typed a total of their own; until then it follows net × price. */
  totalTouched: boolean;
  paid: boolean;
  buyer: string;
}

export interface IHint {
  text: string;
  warn: boolean;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function stockOf(lot: ILot): ILotStock {
  return { left: Math.max(0, lot.totals.left), perPallet: Math.max(1, lot.boxes_per_pallet), tareG: lot.tare_g };
}

/** The price to start with: the last sale's (newest first, with a weight), else the lot's default. */
export function firstPrice(lot: ILotDetail): string {
  const last = lot.sales.find((s) => Number(s.price_kg) > 0 && Number(s.net_kg) > 0);
  const price = last ? last.price_kg : lot.default_price_kg;
  return price && Number(price) > 0 ? inputNumber(price) : '';
}

/** A fresh form: one box, paid on the spot; the price is kept from sale to sale. */
export function newForm(price: string): ISellForm {
  return { unit: 'box', qty: '1', capped: false, gross: '', price, total: '', totalTouched: false, paid: true, buyer: '' };
}

/** The most that can be typed: boxes left, or whole pallets left. */
export function maxQty(unit: SaleUnit, stock: ILotStock): number {
  return unit === 'pallet' ? Math.floor(stock.left / stock.perPallet) : stock.left;
}

/** Cut a typed count down to the maximum (never to below one box). */
export function clampQty(unit: SaleUnit, qty: string, stock: ILotStock): { qty: string; capped: boolean } {
  const max = maxQty(unit, stock);
  return max >= 1 && Number(qty) > max ? { qty: String(max), capped: true } : { qty, capped: false };
}

export function formBoxes(form: ISellForm, stock: ILotStock): number {
  if (form.unit === 'truck') return stock.left;
  const q = Number(form.qty) || 0;
  return form.unit === 'pallet' ? q * stock.perPallet : q;
}

/** The line under the count: what is left, the pallet size, or why no more can be sold. */
export function qtyHint(form: ISellForm, stock: ILotStock): IHint | null {
  const t = i18n.t.bind(i18n);
  if (form.unit === 'truck') {
    const text = stock.left > 0 ? t('market.sell.all_left', { boxes: boxes(stock.left) }) : t('market.sell.nothing_left');
    return { text, warn: false };
  }
  const max = maxQty(form.unit, stock);
  if (form.unit === 'pallet' && max < 1) {
    return { text: t('market.sell.no_pallet', { boxes: boxes(stock.left) }), warn: true };
  }
  if (form.capped) {
    const text = form.unit === 'pallet'
      ? t('market.sell.only_pallets', { n: int(max), boxes: boxes(max * stock.perPallet) })
      : t('market.sell.only_left', { boxes: boxes(stock.left) });
    return { text, warn: true };
  }
  if (form.unit === 'pallet' && Number(form.qty) > 0) {
    const pallets = t('market.fmt.pallets', { count: Number(form.qty) });
    return { text: t('market.sell.pallet_is', { pallets, boxes: boxes(formBoxes(form, stock)) }), warn: false };
  }
  return null;
}

/** Net kg (scale weight minus the empty boxes), or null while no weight is typed. */
export function netOf(form: ISellForm, stock: ILotStock): number | null {
  const gross = parseDecimal(form.gross);
  return gross !== null && gross > 0 ? netKg(gross, formBoxes(form, stock), stock.tareG) : null;
}

/** «Чистый вес: X кг (минус N ящиков по T г)», or the amber «Вес меньше…» under the tare. */
export function netHint(form: ISellForm, stock: ILotStock): IHint | null {
  const net = netOf(form, stock);
  if (net === null) return null;
  const n = formBoxes(form, stock);
  const params = { net: kg(net), boxes: boxes(n), tare: int(stock.tareG) };
  if (net <= 0) return { text: i18n.t('market.sell.below_tare', params), warn: true };
  const key = n > 0 && stock.tareG > 0 ? 'market.sell.net_minus' : 'market.sell.net_is';
  return { text: i18n.t(key, params), warn: false };
}

/** net × price to the cent; 0 while the count, weight or price is missing or wrong. */
export function calcTotal(form: ISellForm, stock: ILotStock): number {
  const n = formBoxes(form, stock);
  const net = netOf(form, stock);
  const price = parseDecimal(form.price) ?? 0;
  return n > 0 && n <= stock.left && net !== null && net > 0 && price > 0 ? round2(net * price) : 0;
}

/** «По формуле: X. Разница: +Y» when a typed total differs from the formula. */
export function totalHint(form: ISellForm, stock: ILotStock, currency: string): string | null {
  const calc = calcTotal(form, stock);
  const typed = parseDecimal(form.total) ?? 0;
  const off = form.totalTouched && calc > 0 && typed > 0 ? round2(typed - calc) : 0;
  if (!off) return null;
  return i18n.t('market.sell.total_diff', { calc: money(calc, currency), off: signedMoney(off, currency) });
}

/** The save button works only for a count the truck still has (weight, price, buyer are checked on press). */
export function canSave(form: ISellForm, stock: ILotStock): boolean {
  const n = formBoxes(form, stock);
  return n > 0 && n <= stock.left && !(form.unit === 'pallet' && maxQty('pallet', stock) < 1);
}
