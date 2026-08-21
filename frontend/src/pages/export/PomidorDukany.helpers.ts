import dayjs, { type Dayjs } from 'dayjs';

/** Which period the analysis covers. */
export type PeriodMode = 'weekly' | 'monthly' | 'seasonal';

/**
 * How far into the period to count.
 *
 * `period` = the whole period. `cumulative` = from the period's start up to
 * (and including) a chosen day — the `Gunluk babatynda` sheet's running total,
 * and sera-butce's "Günlik" granularity.
 */
export type Granularity = 'period' | 'cumulative';

export interface IRangeInput {
  mode: PeriodMode;
  granularity: Granularity;
  /** Anchor for weekly mode. */
  week: Dayjs;
  /** Anchor for monthly mode. */
  month: Dayjs;
  /** Season bounds (ISO dates) for seasonal mode. */
  seasonStart: string | null;
  seasonEnd: string | null;
  /** Cut-off day for `cumulative` granularity. */
  upTo: Dayjs;
}

export interface IDateRange {
  dateFrom: string;
  dateTo: string;
}

const ISO = 'YYYY-MM-DD';

/**
 * Resolve the four screen modes to one inclusive date range.
 *
 * Keeping this pure — and out of the component — is what lets the backend stay
 * a single "sum between two dates" query instead of growing a mode parameter
 * with four branches to keep in sync with the UI.
 *
 * `cumulative` clamps the cut-off day into the period: picking a day outside
 * the selected month must not silently widen or invert the range.
 */
export function resolveRange(input: IRangeInput): IDateRange {
  const { mode, granularity, week, month, seasonStart, seasonEnd, upTo } = input;

  let start: Dayjs;
  let end: Dayjs;

  if (mode === 'weekly') {
    start = week.isoWeekday(1).startOf('day');
    end = start.add(6, 'day');
  } else if (mode === 'monthly') {
    start = month.startOf('month');
    end = month.endOf('month');
  } else {
    // Seasonal. Falls back to the calendar year when no season is loaded yet,
    // so the page renders numbers rather than an error while seasons fetch.
    start = seasonStart ? dayjs(seasonStart) : dayjs().startOf('year');
    end = seasonEnd ? dayjs(seasonEnd) : dayjs().endOf('year');
  }

  if (granularity === 'cumulative') {
    const clamped = upTo.isBefore(start, 'day') ? start : upTo.isAfter(end, 'day') ? end : upTo;
    end = clamped;
  }

  return { dateFrom: start.format(ISO), dateTo: end.format(ISO) };
}

/**
 * Colour band for an achievement percentage.
 *
 * Same thresholds sera-butce uses (≥90 good, ≥60 warning, below that bad) so
 * the two screens do not disagree about what "on track" looks like.
 */
export function achievementTone(pct: number): 'good' | 'warn' | 'bad' {
  if (pct >= 90) return 'good';
  if (pct >= 60) return 'warn';
  return 'bad';
}

/** Signed kg, e.g. `+6 903` / `−1 200`. Uses a real minus sign, not a hyphen. */
export function formatVariance(kg: number): string {
  if (kg === 0) return '0';
  const sign = kg > 0 ? '+' : '−';
  return `${sign}${Math.abs(Math.round(kg)).toLocaleString()}`;
}
