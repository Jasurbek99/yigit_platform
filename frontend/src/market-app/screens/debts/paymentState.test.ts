import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import { payAmount, payHint, paymentBody } from './paymentState';

describe('paymentState', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  it('asks for an amount while there is none', () => {
    expect(payHint('', 5000, 'KZT')).toEqual({ text: 'Напишите сумму.', warn: false });
    expect(payHint('0', 5000, 'KZT')).toEqual({ text: 'Напишите сумму.', warn: false });
    expect(payAmount('', 5000)).toBe(0);
  });

  it('says the debt closes when the whole due is paid', () => {
    expect(payHint('5 000', 5000, 'KZT').text).toBe('Долг будет закрыт полностью.');
  });

  it('shows what stays owed after a part payment', () => {
    expect(payHint('1 250,5', 5000, 'KZT').text).toMatch(/^Останется долг: 3\s749,5\s₸$/);
  });

  it('warns and caps an amount above the due', () => {
    const hint = payHint('7000', 5000, 'RUB');
    expect(hint.text).toMatch(/^Это больше долга\. Запишу 5\s000\s₽\.$/);
    expect(hint.warn).toBe(true);
    expect(payAmount('7000', 5000)).toBe(5000);
  });

  it('builds the POST body with the capped amount', () => {
    expect(paymentBody(4, 'KZT', '5 000', 1250000)).toEqual({ buyer_id: 4, currency: 'KZT', amount: '5000.00' });
    expect(paymentBody(4, 'KZT', '2 000 000', 1250000)?.amount).toBe('1250000.00');
    expect(paymentBody(4, 'KZT', '', 1250000)).toBeNull();
  });
});
