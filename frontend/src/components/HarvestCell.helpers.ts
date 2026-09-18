import dayjs from 'dayjs';
import type { IGreenhouseConfig, ForecastWindow, IHarvestDayEntry } from '@/types';

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

/**
 * The ±maxPct window a greenhouse manager may request once the cell's plan week
 * has started (ADR-024). Null when no bound applies: the week hasn't started,
 * or the baseline is empty or zero. The baseline is `plan_baseline_value`, or the
 * current plan when it hasn't been frozen yet (the server freezes it on the first
 * request). Mirrors backend `_bounded_change_pct`, which stays authoritative.
 */
export function planChangeRange(
  entry: Pick<IHarvestDayEntry, 'entry_date' | 'plan_value' | 'plan_baseline_value'>,
  maxPct: number,
  today: dayjs.Dayjs,
): { min: number; max: number } | null {
  const date = dayjs(entry.entry_date);
  const weekMonday = date.subtract((date.day() + 6) % 7, 'day');
  if (today.isBefore(weekMonday, 'day')) return null;
  const baseline = Number(entry.plan_baseline_value ?? entry.plan_value ?? 0);
  if (!baseline) return null;
  // Multiply before dividing: `10000 * 1.15` is 11499.999… in floating point.
  return {
    min: Math.ceil((baseline * (100 - maxPct)) / 100),
    max: Math.floor((baseline * (100 + maxPct)) / 100),
  };
}
