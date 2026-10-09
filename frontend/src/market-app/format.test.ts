import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import { boxes, groupThousands, kg, money, netKg, parseDecimal, pluralRu } from './format';

const NB = '\u00a0';

describe('groupThousands (live input)', () => {
  it.each([
    ['1000000', 0, '1 000 000'],
    ['12,5', 2, '12,5'],
    ['12.5', 2, '12,5'],
    ['12,', 2, '12,'],
    ['1 2345,678', 2, '12 345,67'],
    ['007', 0, '7'],
    ['12,5', 0, '12'],
    ['abc', 0, ''],
  ])('%s with %d decimals → %s', (raw, decimals, out) => {
    expect(groupThousands(raw, decimals)).toBe(out);
  });
});

describe('parseDecimal', () => {
  it.each([
    ['1 000 000', 1000000],
    ['12,5', 12.5],
    [`25${NB}700.50`, 25700.5],
    ['', null],
    ['  ', null],
    ['abc', null],
    ['1,2,3', null],
  ])('%s → %s', (raw, out) => {
    expect(parseDecimal(raw)).toBe(out);
  });
});

describe('money / kg', () => {
  it('puts the symbol after the amount, groups thousands, trims zero decimals', () => {
    expect(money('25700.00', 'KZT')).toBe(`25${NB}700${NB}₸`);
    expect(money(18000, 'RUB')).toBe(`18${NB}000${NB}₽`);
    expect(money('45.50', 'KZT')).toBe(`45,5${NB}₸`);
    expect(money('-1234567.25', 'KZT')).toBe(`-1${NB}234${NB}567,25${NB}₸`);
  });

  it('falls back to the currency code for an unknown currency', () => {
    expect(money('10', 'USD')).toBe(`10${NB}USD`);
  });

  it('formats kg with a decimal comma', () => {
    expect(kg('80.50')).toBe('80,5');
    expect(kg(1250)).toBe(`1${NB}250`);
  });
});

describe('plurals', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  it.each([
    [1, 'ящик'], [2, 'ящика'], [5, 'ящиков'], [11, 'ящиков'], [21, 'ящик'], [22, 'ящика'], [112, 'ящиков'],
  ])('pluralRu(%d) → %s', (n, word) => {
    expect(pluralRu(n, 'ящик', 'ящика', 'ящиков')).toBe(word);
  });

  it.each([[1, '1 ящик'], [2, '2 ящика'], [5, '5 ящиков'], [11, '11 ящиков'], [21, '21 ящик']])(
    'boxes(%d) → %s',
    (n, text) => {
      expect(boxes(n)).toBe(text);
    },
  );
});

describe('netKg (preview)', () => {
  it('subtracts the tare of every box', () => {
    expect(netKg(104.5, 10, 450)).toBe(100);
    expect(netKg(80.5, 12, 450)).toBe(75.1);
  });
});
