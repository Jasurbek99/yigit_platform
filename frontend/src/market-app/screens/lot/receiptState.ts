// The agent's «Приёмка» sheet: its typed form, the checks, the PATCH body and the server's answer.
import i18n from '@/i18n';
import { httpStatus, NON_FIELD_KEYS } from '@/utils/drfErrors';
import { apiDecimal, inputNumber } from '../../format';
import type { ILot, ILotUpdateInput } from '../../types';
import { readableBody, readableError } from './saleBody';

/** Typed text, as in the fields (digits only; the price may have spaces and a comma). */
export interface IReceiptForm {
  boxes: string;
  perPallet: string;
  tare: string;
  price: string;
}

export type ReceiptField = 'boxes_received' | 'boxes_per_pallet' | 'tare_g' | 'default_price_kg';
/** One message per field; `_` is the sheet's line. */
export type ReceiptErrors = Partial<Record<ReceiptField | '_', string>>;

/** The lot's values; the box count and boxes per pallet are blank while they are still placeholders. */
export function receiptForm(lot: ILot): IReceiptForm {
  return {
    boxes: lot.needs_receipt ? '' : String(lot.boxes_received),
    perPallet: lot.needs_receipt ? '' : String(lot.boxes_per_pallet),
    tare: String(lot.tare_g),
    price: lot.default_price_kg === null ? '' : inputNumber(lot.default_price_kg),
  };
}

/** Box count, boxes per pallet and tare are required; the price may stay empty. */
export function checkReceipt(form: IReceiptForm): ReceiptErrors | null {
  const required = i18n.t('market.agent.required');
  const out: ReceiptErrors = {};
  if (!form.boxes) out.boxes_received = required;
  if (!form.perPallet) out.boxes_per_pallet = required;
  if (!form.tare) out.tare_g = required;
  return Object.keys(out).length ? out : null;
}

/**
 * Only what changed. The box count and boxes per pallet go whenever the receipt is pending, even
 * unchanged: the server confirms the receipt only when the key is sent. Call after checkReceipt.
 */
export function receiptBody(form: IReceiptForm, lot: ILot): ILotUpdateInput {
  const body: ILotUpdateInput = {};
  const boxes = Number(form.boxes);
  const perPallet = Number(form.perPallet);
  if (lot.needs_receipt || boxes !== lot.boxes_received) body.boxes_received = boxes;
  if (lot.needs_receipt || perPallet !== lot.boxes_per_pallet) body.boxes_per_pallet = perPallet;
  if (Number(form.tare) !== lot.tare_g) body.tare_g = Number(form.tare);
  const price = apiDecimal(form.price);
  if (price !== lot.default_price_kg) body.default_price_kg = price;
  return body;
}

/**
 * A refused PATCH → messages per field. The one field-less 400 of the receipt is «Уже продано или
 * списано: N ящиков…», so it goes under the box count when the count was sent; 403 / 409 / 5xx /
 * no answer go to the sheet's line.
 */
export function receiptErrors(err: unknown, sentBoxes: boolean): ReceiptErrors {
  const body = readableBody(err);
  if (!body) return { _: readableError(err) ?? i18n.t('market.agent.save_error') };
  const boxesLine = sentBoxes && httpStatus(err) === 400;
  const out: ReceiptErrors = {};
  for (const [key, messages] of Object.entries(body)) {
    let field: ReceiptField | '_' = '_';
    if (key === 'boxes_received' || key === 'boxes_per_pallet' || key === 'tare_g' || key === 'default_price_kg') {
      field = key;
    } else if (boxesLine && NON_FIELD_KEYS.includes(key)) {
      field = 'boxes_received';
    }
    out[field] ??= messages[0];
  }
  return out;
}
