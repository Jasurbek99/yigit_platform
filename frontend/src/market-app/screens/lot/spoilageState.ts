// The spoilage sheet's pure logic (artifact `saveBad` / `updateForm` for the «bad» unit; study §3.7).
// A preview only: the server re-checks the boxes left and the tare under the lot lock.
import i18n from '@/i18n';
import { apiDecimal, boxes, int, kg, netKg, parseDecimal } from '../../format';
import type { ISpoilageInput } from '../../types';
import type { IHint, ILotStock } from './sellFormState';

/** The sheet as typed: boxes as digits ('' while retyped), the optional scale weight. */
export interface ISpoilForm {
  boxes: string;
  /** The count was cut down to what is left — show the amber hint. */
  capped: boolean;
  gross: string;
}

/** Cut a typed count down to what is left; the minimum is 0 here. */
export function clampBoxes(raw: string, stock: ILotStock): Pick<ISpoilForm, 'boxes' | 'capped'> {
  return Number(raw) > stock.left ? { boxes: String(stock.left), capped: true } : { boxes: raw, capped: false };
}

/** Net kg of a typed weight, or null while no weight is typed (it is optional). */
function netOf(form: ISpoilForm, stock: ILotStock): number | null {
  const gross = parseDecimal(form.gross);
  return gross === null || gross <= 0 ? null : netKg(gross, Number(form.boxes) || 0, stock.tareG);
}

/** Under the count: «Только вес…» at 0 boxes, «В машине осталось только N» after a cap. */
export function boxesHint(form: ISpoilForm, stock: ILotStock): IHint | null {
  if (form.capped) return { text: i18n.t('market.sell.only_left', { boxes: boxes(stock.left) }), warn: true };
  if (!(Number(form.boxes) > 0)) return { text: i18n.t('market.spoil.only_weight'), warn: false };
  return null;
}

/** Under the weight: «Вес можно не писать.», the net weight, or the amber «Вес меньше…». */
export function spoilWeightHint(form: ISpoilForm, stock: ILotStock): IHint {
  const net = netOf(form, stock);
  if (net === null) return { text: i18n.t('market.spoil.weight_optional'), warn: false };
  const n = Number(form.boxes) || 0;
  const params = { net: kg(net), boxes: boxes(n), tare: int(stock.tareG) };
  if (net < 0) return { text: i18n.t('market.sell.below_tare', params), warn: true };
  return { text: i18n.t(n > 0 && stock.tareG > 0 ? 'market.sell.net_minus' : 'market.sell.net_is', params), warn: false };
}

/** «Списать» needs boxes or a weight, no more boxes than left, and a weight not below the empty boxes. */
export function canWriteOff(form: ISpoilForm, stock: ILotStock): boolean {
  const n = Number(form.boxes) || 0;
  const net = netOf(form, stock);
  return (n > 0 || net !== null) && n <= stock.left && (net === null || net >= 0);
}

/** POST …/spoilage/ body; an empty (or zero) weight is null, never 0 — 0 would be read as a weight. */
export function spoilBody(form: ISpoilForm): ISpoilageInput {
  const gross = parseDecimal(form.gross);
  return { boxes: Number(form.boxes) || 0, gross_kg: gross !== null && gross > 0 ? apiDecimal(form.gross) : null };
}
