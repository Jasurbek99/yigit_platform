// Checks on «Сохранить продажу», the request body and the server's answer (study §3.5 save order).
import i18n from '@/i18n';
import { drfFieldErrors, NON_FIELD_KEYS } from '@/utils/drfErrors';
import { apiDecimal, parseDecimal } from '../../format';
import type { ISaleInput } from '../../types';
import { netHint, netOf, type ILotStock, type ISellForm } from './sellFormState';

export type SellField = 'qty' | 'gross_kg' | 'price_kg' | 'total' | 'buyer_id';
/** One message per field; `_` is the form-level line. */
export type SellErrors = Partial<Record<SellField | '_', string>>;

/** Server keys shown under a field; `name` comes from creating the debt buyer. */
const FIELD_OF: Readonly<Record<string, SellField>> = {
  qty: 'qty', gross_kg: 'gross_kg', price_kg: 'price_kg', total: 'total', buyer_id: 'buyer_id', name: 'buyer_id',
};

/** The first thing that stops the save, in the study's order: weight, weight vs tare, price, buyer. */
export function checkSale(form: ISellForm, stock: ILotStock): SellErrors | null {
  const net = netOf(form, stock);
  if (net === null) return { gross_kg: i18n.t('market.sell.need_weight') };
  if (net <= 0) return { gross_kg: netHint(form, stock)?.text ?? i18n.t('market.sell.need_weight') };
  if (!((parseDecimal(form.price) ?? 0) > 0)) return { price_kg: i18n.t('market.sell.need_price') };
  if (!form.paid && !form.buyer.trim()) return { buyer_id: i18n.t('market.sell.need_buyer') };
  return null;
}

/** POST …/sales/ body. `total` only when the seller typed one, `buyer_id` only on debt. Call after checkSale. */
export function saleBody(form: ISellForm, buyerId?: number): ISaleInput {
  const body: ISaleInput = {
    unit: form.unit,
    // Boxes or pallets as typed; the server counts a whole truck itself.
    qty: form.unit === 'truck' ? 1 : Number(form.qty),
    gross_kg: apiDecimal(form.gross) ?? '',
    price_kg: apiDecimal(form.price) ?? '',
    paid_on_spot: form.paid,
  };
  const total = form.totalTouched ? apiDecimal(form.total) : null;
  if (total !== null && Number(total) > 0) body.total = total;
  if (!form.paid && buyerId !== undefined) body.buyer_id = buyerId;
  return body;
}

/** A failed save → messages per field; a non-field message (or no answer at all: `fallback`) → `_`. */
export function sellErrors(err: unknown, fallback: string): SellErrors {
  const fields = drfFieldErrors(err);
  if (!fields) return { _: fallback };
  const out: SellErrors = {};
  for (const [key, messages] of Object.entries(fields)) {
    const field = NON_FIELD_KEYS.includes(key) ? '_' : FIELD_OF[key] ?? '_';
    out[field] ??= messages[0] ?? fallback;
  }
  return out;
}
