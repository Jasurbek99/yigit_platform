import dayjs from 'dayjs';
import type { IGreenhouseConfig, ForecastWindow } from '@/types';

/** Safely parse a Decimal string like "18000.00" to number. Returns 0 for null. */
export function num(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

/** Format kg value. Null/undefined → em-dash string. */
export function fmtKg(val: string | number | null | undefined): string {
  if (val == null) return '—';
  const n = Number(val);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

function parseTime(timeStr: string): [number, number, number] {
  const parts = timeStr.split(':').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Return the forecast window given current time and config.
 * `entryDate` is the target day being forecast.
 */
export function getCurrentForecastWindow(
  now: dayjs.Dayjs,
  entryDate: dayjs.Dayjs,
  config: IGreenhouseConfig,
): ForecastWindow | null {
  const today = now.startOf('day');
  const tomorrow = today.add(1, 'day');
  const isForTomorrow = entryDate.isSame(tomorrow, 'day');
  const isForToday = entryDate.isSame(today, 'day');

  if (!isForTomorrow && !isForToday) return null;

  const [ph, pm] = parseTime(config.forecast_primary_open);
  const [ch, cm] = parseTime(config.forecast_primary_close);
  const [fh, fm] = parseTime(config.forecast_fallback_close);
  const [sh, sm] = parseTime(config.forecast_same_day_close);

  const nowMinutes = now.hour() * 60 + now.minute();
  const primaryOpenMins = ph * 60 + pm;
  const primaryCloseMins = ch * 60 + cm;
  const fallbackCloseMins = fh * 60 + fm;
  const sameDayCloseMins = sh * 60 + sm;

  if (isForTomorrow) {
    if (nowMinutes >= primaryOpenMins && nowMinutes < primaryCloseMins) return 'primary';
    if (nowMinutes >= primaryCloseMins && nowMinutes < fallbackCloseMins) return 'fallback';
    if (nowMinutes < sameDayCloseMins) return 'same_day_red_flag';
    return null;
  }

  if (isForToday) {
    if (nowMinutes < sameDayCloseMins) return 'same_day_red_flag';
    return null;
  }

  return null;
}
