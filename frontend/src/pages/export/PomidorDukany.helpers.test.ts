import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import {
  achievementTone,
  formatVariance,
  resolveRange,
  type IRangeInput,
} from './PomidorDukany.helpers';

dayjs.extend(isoWeek);

/** W10/2026 runs Mon 2026-03-02 → Sun 2026-03-08. */
function input(overrides: Partial<IRangeInput> = {}): IRangeInput {
  return {
    mode: 'monthly',
    granularity: 'period',
    week: dayjs('2026-03-04'), // a Wednesday inside W10
    month: dayjs('2026-03-15'),
    seasonStart: '2025-09-01',
    seasonEnd: '2026-08-31',
    upTo: dayjs('2026-03-10'),
    ...overrides,
  };
}

describe('resolveRange', () => {
  it('weekly mode spans Monday to Sunday of the anchored ISO week', () => {
    expect(resolveRange(input({ mode: 'weekly' }))).toEqual({
      dateFrom: '2026-03-02',
      dateTo: '2026-03-08',
    });
  });

  it('monthly mode spans the whole calendar month', () => {
    expect(resolveRange(input({ mode: 'monthly' }))).toEqual({
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    });
  });

  it('seasonal mode uses the season bounds', () => {
    expect(resolveRange(input({ mode: 'seasonal' }))).toEqual({
      dateFrom: '2025-09-01',
      dateTo: '2026-08-31',
    });
  });

  it('seasonal mode falls back to the calendar year when no season is loaded', () => {
    const r = resolveRange(input({ mode: 'seasonal', seasonStart: null, seasonEnd: null }));
    expect(r.dateFrom.slice(4)).toBe('-01-01');
    expect(r.dateTo.slice(4)).toBe('-12-31');
  });

  it('cumulative granularity ends on the chosen day, not the period end', () => {
    expect(resolveRange(input({ granularity: 'cumulative' }))).toEqual({
      dateFrom: '2026-03-01',
      dateTo: '2026-03-10',
    });
  });

  /**
   * The cut-off day and the period are picked independently, so the user can
   * leave one behind when changing the other. Clamping keeps the range inside
   * the period instead of silently widening it or inverting it (which the
   * backend rejects with a 400).
   */
  it('clamps a cut-off day that falls after the period end', () => {
    const r = resolveRange(input({ granularity: 'cumulative', upTo: dayjs('2026-05-20') }));
    expect(r).toEqual({ dateFrom: '2026-03-01', dateTo: '2026-03-31' });
  });

  it('clamps a cut-off day that falls before the period start', () => {
    const r = resolveRange(input({ granularity: 'cumulative', upTo: dayjs('2026-01-05') }));
    expect(r).toEqual({ dateFrom: '2026-03-01', dateTo: '2026-03-01' });
  });

  it('never produces an inverted range across the modes', () => {
    for (const mode of ['weekly', 'monthly', 'seasonal'] as const) {
      for (const granularity of ['period', 'cumulative'] as const) {
        const r = resolveRange(input({ mode, granularity, upTo: dayjs('2020-01-01') }));
        expect(r.dateFrom <= r.dateTo).toBe(true);
      }
    }
  });
});

describe('achievementTone', () => {
  it.each([
    [100, 'good'],
    [90, 'good'],
    [89.9, 'warn'],
    [60, 'warn'],
    [59.9, 'bad'],
    [0, 'bad'],
  ])('%s%% is %s', (pct, expected) => {
    expect(achievementTone(pct as number)).toBe(expected);
  });
});

describe('formatVariance', () => {
  it('prefixes a surplus with +', () => {
    expect(formatVariance(6903)).toBe('+6,903');
  });

  it('prefixes a shortfall with a minus sign and drops the raw negative', () => {
    expect(formatVariance(-1200)).toBe('−1,200');
  });

  it('renders an exact match as a bare zero', () => {
    expect(formatVariance(0)).toBe('0');
  });
});
