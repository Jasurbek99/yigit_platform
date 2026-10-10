// The payment sheet's amount: the live hint and the capped amount (study §3.10, artifact `paySheet`).
import i18n from '@/i18n';
import { money, parseDecimal } from '../../format';
import type { IPaymentInput } from '../../types';

export interface IPayHint {
  text: string;
  /** Amber: more than the due was typed. */
  warn: boolean;
}

const cents = (n: number): number => Math.round(n * 100);

/** What will be recorded: the typed amount capped at `due`; 0 while nothing valid is typed. */
export function payAmount(raw: string, due: number): number {
  const typed = parseDecimal(raw) ?? 0;
  if (!(cents(typed) > 0)) return 0;
  return Math.min(cents(typed), cents(due)) / 100;
}

/** «Напишите сумму.» / «Это больше долга. Запишу X.» / «Долг будет закрыт полностью.» / «Останется долг: X». */
export function payHint(raw: string, due: number, currency: string): IPayHint {
  const typed = cents(parseDecimal(raw) ?? 0);
  if (!(typed > 0)) return { text: i18n.t('market.pay.need'), warn: false };
  if (typed > cents(due)) return { text: i18n.t('market.pay.over', { v: money(due, currency) }), warn: true };
  if (typed === cents(due)) return { text: i18n.t('market.pay.full'), warn: false };
  return { text: i18n.t('market.pay.left', { v: money((cents(due) - typed) / 100, currency) }), warn: false };
}

/** POST /market/payments/ body, or null while there is no amount to record. */
export function paymentBody(buyerId: number, currency: string, raw: string, due: number): IPaymentInput | null {
  const amount = payAmount(raw, due);
  return amount > 0 ? { buyer_id: buyerId, currency, amount: amount.toFixed(2) } : null;
}
