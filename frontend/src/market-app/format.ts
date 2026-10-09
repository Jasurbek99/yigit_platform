// Numbers the way the market app shows and takes them (artifact `groupInput`, `fmt`, `fmc`, `plural`):
// spaces between thousands, a comma for decimals, the currency sign after the amount.
import i18n from '@/i18n';

/** No-break space: "25 700 ₸" never wraps inside the amount. */
const NBSP = ' ';
const SYMBOLS: Readonly<Record<string, string>> = { KZT: '₸', RUB: '₽' };

function groupDigits(whole: string, sep: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * While typing: digits only, a space after every three, a comma or a dot as the decimal
 * mark (shown as a comma), at most `decimals` decimals, at most 12 whole digits.
 */
export function groupThousands(raw: string, decimals: number): string {
  const clean = raw.replace(/[^\d.,]/g, '');
  const mark = clean.search(/[.,]/);
  const whole = (mark < 0 ? clean : clean.slice(0, mark)).replace(/^0+(?=\d)/, '').slice(0, 12);
  const dec = mark >= 0 && decimals > 0 ? `,${clean.slice(mark + 1).replace(/[.,]/g, '').slice(0, decimals)}` : '';
  return groupDigits(whole, ' ') + dec;
}

/** "1 250 000,5" / "12.5" → number; empty or not a number → null. */
export function parseDecimal(s: string): number | null {
  const compact = s.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(compact)) return null;
  return Number(compact);
}

/** `v` rounded to `decimals`, thousands grouped, trailing zero decimals dropped: 25695.50 → "25 695,5". */
function formatNumber(v: string | number, decimals: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, dec] = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').split('.');
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : '';
  return sign + groupDigits(whole, NBSP) + (dec ? `,${dec}` : '');
}

/** "25 700 ₸", "18 000 ₽" — the sign after the amount; an unknown currency shows its code. */
export function money(v: string | number, currency: string): string {
  return `${formatNumber(v, 2)}${NBSP}${SYMBOLS[currency] ?? currency}`;
}

/** Minus sign (U+2212) before an amount, the artifact's `plain`: −1 000 ₸ / 1 000 ₸. */
export function plainMoney(v: string | number, currency: string): string {
  const n = Number(v);
  return (n < 0 ? '−' : '') + money(Math.abs(n), currency);
}

/** Always signed, the artifact's `signed`: +200 ₸ / −200 ₸. */
export function signedMoney(v: string | number, currency: string): string {
  return (Number(v) > 0 ? '+' : '−') + money(Math.abs(Number(v)), currency);
}

/** A whole count with thousands grouped: 1 000. */
export function int(n: number): string {
  return formatNumber(n, 0);
}

/** Kilograms as a number ("80,5"); the unit word comes from the i18n string around it. */
export function kg(v: string | number): string {
  return formatNumber(v, 2);
}

/** Russian plural form of `n`: 1 ящик, 2 ящика, 5 ящиков (11–14 → many). */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  const d = abs % 10;
  const h = abs % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

/** "1 ящик", "2 ящика", "5 ящиков" in the current language. */
export function boxes(n: number): string {
  return i18n.t('market.fmt.boxes', { count: n });
}

/** Net weight preview: scale weight minus the tare of every box, to 0.01 kg. The server is the authority. */
export function netKg(grossKg: number, boxCount: number, tareG: number): number {
  return Math.round((grossKg - (boxCount * tareG) / 1000) * 100) / 100;
}
