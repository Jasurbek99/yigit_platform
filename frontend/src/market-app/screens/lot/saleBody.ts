// Checks on «Сохранить продажу», the request body and the server's answer (study §3.5 save order).
import i18n from '@/i18n';
import { drfFieldErrors, httpStatus, NON_FIELD_KEYS } from '@/utils/drfErrors';
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

/** Statuses whose body is a message for people (field errors, `{error}` texts); others carry codes. */
const READABLE_STATUSES: readonly number[] = [400, 403, 404];
/** `idempotency_in_progress`, `server_error`, `invalid_idempotency_key`: never shown as they are. */
const MACHINE_CODE = /^[a-z_]+$/;

/** The failure's body when it is meant to be read: 400 / 403 / 404 only, machine codes dropped. */
export function readableBody(err: unknown): Record<string, string[]> | null {
  const status = httpStatus(err);
  if (status === undefined || !READABLE_STATUSES.includes(status)) return null;
  const fields = drfFieldErrors(err);
  if (!fields) return null;
  const kept = Object.entries(fields).filter(([, m]) => m.length > 0 && !MACHINE_CODE.test(m[0]));
  return kept.length ? Object.fromEntries(kept) : null;
}

/** The text to show for a failed write: the server's own message, «ещё идёт» for a 409, else null. */
export function readableError(err: unknown): string | null {
  if (httpStatus(err) === 409) return i18n.t('market.sell.in_progress');
  const body = readableBody(err);
  if (!body) return null;
  return NON_FIELD_KEYS.map((k) => body[k]?.[0]).find(Boolean) ?? null;
}

/**
 * A failed save → messages per field; a non-field message → `_`; codes, 409, no answer → a fixed text.
 * A 5xx may have come after the commit, so it says «Проверьте список…» (`maybeSavedKey`) — the hooks
 * refetch the lot, and the Idempotency-Key is kept, so a retry replays rather than sells twice.
 */
export function sellErrors(err: unknown, maybeSavedKey = 'market.sell.maybe_saved'): SellErrors {
  if ((httpStatus(err) ?? 0) >= 500) return { _: i18n.t(maybeSavedKey) };
  const fallback = i18n.t('market.sell.save_error');
  const body = readableBody(err);
  if (!body) return { _: readableError(err) ?? fallback };
  const out: SellErrors = {};
  for (const [key, messages] of Object.entries(body)) {
    const field = NON_FIELD_KEYS.includes(key) ? '_' : FIELD_OF[key] ?? '_';
    out[field] ??= messages[0];
  }
  return out;
}
