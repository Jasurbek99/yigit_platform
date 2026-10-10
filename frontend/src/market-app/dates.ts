// Dates and times of the market app in the phone's own time zone (artifact `dayText`, `hm`, `dayLong`).
import i18n from '@/i18n';

/** The app's numbers and dates are Russian-style in every language (see format.ts). */
const LOCALE = 'ru-RU';

/** "8 окт." */
export function dayShort(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** "14:35" */
export function hm(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** The local calendar day of `iso`, for grouping. */
export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/** "Сегодня, 8 октября" or "7 октября". */
export function dayLong(iso: string): string {
  const text = new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });
  return dayKey(iso) === new Date().toDateString() ? i18n.t('market.lot.today', { date: text }) : text;
}

/** "14:35" today, "7 окт. 14:35" on other days (artifact `timeText`). */
export function whenText(iso: string): string {
  return dayKey(iso) === new Date().toDateString() ? hm(iso) : `${dayShort(iso)} ${hm(iso)}`;
}
