import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import { apiDecimal } from '../../format';
import { lotDetailFixture, lotFixture } from '../../testFixtures';
import {
  calcTotal, canSave, clampQty, firstPrice, formBoxes, netHint, newForm, qtyHint, stockOf, totalHint,
  type ISellForm,
} from './sellFormState';
import { checkSale, readableError, saleBody, sellErrors } from './saleBody';

const SAVE_ERROR = 'Не удалось сохранить. Проверьте интернет и нажмите ещё раз.';

/** 68 boxes left, 50 per pallet, 450 g per empty box. */
const stock = stockOf(lotFixture());
const form = (over: Partial<ISellForm>): ISellForm => ({ ...newForm('45'), ...over });
const nb = (s: string): string => s.replace(/\u00a0/g, ' ');

describe('sellFormState', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  it('counts the boxes of a box, pallet and whole-truck sale', () => {
    expect(formBoxes(form({ qty: '10' }), stock)).toBe(10);
    expect(formBoxes(form({ unit: 'pallet', qty: '1' }), stock)).toBe(50);
    expect(formBoxes(form({ unit: 'truck', qty: '1' }), stock)).toBe(68);
  });

  it('caps boxes at what is left, with the amber hint', () => {
    expect(clampQty('box', '70', stock)).toEqual({ qty: '68', capped: true });
    expect(clampQty('box', '12', stock)).toEqual({ qty: '12', capped: false });
    expect(qtyHint(form({ qty: '68', capped: true }), stock)).toEqual({
      text: 'В машине осталось только 68 ящиков', warn: true,
    });
    expect(qtyHint(form({ qty: '12' }), stock)).toBeNull();
  });

  it('caps pallets at whole pallets and explains a pallet', () => {
    expect(clampQty('pallet', '3', stock)).toEqual({ qty: '1', capped: true });
    expect(nb(qtyHint(form({ unit: 'pallet', qty: '1', capped: true }), stock)?.text ?? ''))
      .toBe('Больше нельзя: целых паллет осталось 1 (50 ящиков)');
    expect(qtyHint(form({ unit: 'pallet', qty: '1' }), stock)).toEqual({ text: '1 паллета = 50 ящиков', warn: false });
  });

  it('refuses a pallet when no whole pallet is left', () => {
    const short = { ...stock, left: 30 };
    expect(qtyHint(form({ unit: 'pallet', qty: '1' }), short)).toEqual({
      text: 'На целую паллету не хватает. Осталось 30 ящиков.', warn: true,
    });
    expect(canSave(form({ unit: 'pallet', qty: '1' }), short)).toBe(false);
    expect(canSave(form({ qty: '30' }), short)).toBe(true);
    expect(canSave(form({ qty: '0' }), short)).toBe(false);
  });

  it('shows what is left for a whole-truck sale', () => {
    expect(qtyHint(form({ unit: 'truck' }), stock)).toEqual({ text: 'Всё, что осталось: 68 ящиков', warn: false });
    expect(qtyHint(form({ unit: 'truck' }), { ...stock, left: 0 })?.text).toBe('В машине ничего не осталось');
  });

  it('takes the empty boxes off the scale weight', () => {
    expect(netHint(form({ qty: '10', gross: '104,5' }), stock)).toEqual({
      text: 'Чистый вес: 100 кг (минус 10 ящиков по 450 г)', warn: false,
    });
    expect(netHint(form({ qty: '10', gross: '4' }), stock)).toEqual({
      text: 'Вес меньше, чем весят пустые ящики (10 ящиков по 450 г).', warn: true,
    });
    expect(netHint(form({ qty: '10', gross: '' }), stock)).toBeNull();
  });

  it('calculates the total and shows a corrected total against the formula', () => {
    expect(calcTotal(form({ qty: '10', gross: '104,5' }), stock)).toBe(4500);
    expect(calcTotal(form({ qty: '10', gross: '4' }), stock)).toBe(0);
    expect(nb(totalHint(form({ qty: '10', gross: '104,5', total: '4 510', totalTouched: true }), stock, 'KZT') ?? ''))
      .toBe('По формуле: 4 500 ₸. Разница: +10 ₸');
    expect(totalHint(form({ qty: '10', gross: '104,5', total: '4 500', totalTouched: true }), stock, 'KZT')).toBeNull();
    expect(totalHint(form({ qty: '10', gross: '104,5' }), stock, 'KZT')).toBeNull();
  });

  it('prefills the price from the last sale, else the lot default', () => {
    expect(firstPrice(lotDetailFixture())).toBe('45');
    expect(firstPrice({ ...lotDetailFixture(), sales: [], default_price_kg: '1250.50' })).toBe('1 250,5');
    expect(firstPrice({ ...lotDetailFixture(), sales: [] })).toBe('');
  });
});

describe('saleBody', () => {
  it('blocks a missing weight, a weight under the tare, no price and a debt without a buyer', () => {
    expect(checkSale(form({ qty: '10', gross: '' }), stock)).toEqual({ gross_kg: 'Напишите вес с весов.' });
    expect(checkSale(form({ qty: '10', gross: '4' }), stock))
      .toEqual({ gross_kg: 'Вес меньше, чем весят пустые ящики (10 ящиков по 450 г).' });
    expect(checkSale(form({ qty: '10', gross: '104,5', price: '' }), stock)).toEqual({ price_kg: 'Напишите цену за 1 кг.' });
    expect(checkSale(form({ qty: '10', gross: '104,5', paid: false, buyer: '  ' }), stock))
      .toEqual({ buyer_id: 'Укажите покупателя.' });
    expect(checkSale(form({ qty: '10', gross: '104,5' }), stock)).toBeNull();
  });

  it('builds the request body with two decimals and no optional keys', () => {
    expect(saleBody(form({ qty: '10', gross: '104,5' })))
      .toEqual({ unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', paid_on_spot: true });
    expect(saleBody(form({ qty: '10', gross: '104,5', total: '4 510', totalTouched: true, paid: false }), 4))
      .toEqual({ unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', total: '4510.00', paid_on_spot: false, buyer_id: 4 });
    expect(saleBody(form({ unit: 'truck', qty: '5', gross: '1 000' })).qty).toBe(1);
    expect(saleBody(form({ unit: 'pallet', qty: '1', gross: '400' })).qty).toBe(1);
  });

  it('puts a server message under its field, anything else on the form line', () => {
    const bad = (data: object, status = 400): object => ({ response: { status, data } });
    expect(sellErrors(bad({ gross_kg: ['Мало'] }))).toEqual({ gross_kg: 'Мало' });
    expect(sellErrors(bad({ error: 'Закрыта' }))).toEqual({ _: 'Закрыта' });
    expect(sellErrors(bad({ detail: 'Нельзя' }, 403))).toEqual({ _: 'Нельзя' });
    expect(sellErrors(bad({ unit: ['Плохо'] }))).toEqual({ _: 'Плохо' });
    expect(sellErrors(bad({ name: ['Длинно'] }))).toEqual({ buyer_id: 'Длинно' });
    expect(sellErrors(new Error('offline'))).toEqual({ _: SAVE_ERROR });
  });

  it('never shows a machine code: 409 is «still saving», any other status the save error', () => {
    const bad = (data: object, status: number): object => ({ response: { status, data } });
    expect(sellErrors(bad({ error: 'idempotency_in_progress' }, 409)))
      .toEqual({ _: 'Предыдущее сохранение ещё идёт — подождите секунду.' });
    expect(sellErrors(bad({ error: 'server_error' }, 500))).toEqual({ _: SAVE_ERROR });
    expect(sellErrors(bad({ error: 'invalid_idempotency_key' }, 400))).toEqual({ _: SAVE_ERROR });
    expect(sellErrors(bad({ error: 'Ой' }, 418))).toEqual({ _: SAVE_ERROR });
    expect(readableError(bad({ error: 'server_error' }, 500))).toBeNull();
    expect(readableError(bad({ error: 'Уже удалено' }, 404))).toBe('Уже удалено');
  });
});

describe('apiDecimal', () => {
  it('sends two decimals, and null — never 0 — for an empty field', () => {
    expect(apiDecimal('104,5')).toBe('104.50');
    expect(apiDecimal('1 250,5')).toBe('1250.50');
    expect(apiDecimal('')).toBeNull();
    expect(apiDecimal('  ')).toBeNull();
  });
});
