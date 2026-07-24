/**
 * Sera Bütçe — Üretim Planı (haftalık) page mock data.
 *
 * The source app lets managers enter a WEEKLY tonnage plan per block; every
 * week's total is then split equally across the week's working days (Sunday
 * and any user-added "izin günü" are excluded). `Uretim.tsx` (Aylık Üretim)
 * treats this page as the source of truth and rolls the weeks up into months
 * — so this file builds weekly figures that sum back to
 * `MONTHLY_PRODUCTION_BY_BLOCK` (mock/uretim.ts) for cross-page consistency.
 *
 * Weeks run Sunday→Saturday, 53 of them, starting on the Sunday on/before
 * Jan 1 of `UP_YEAR` (this makes "Hafta 1" = 28 Dec–3 Jan and "Hafta 53" =
 * 27 Dec–2 Jan next year, matching the source screenshot exactly).
 */
import { SERA_BLOCKS } from './seraData';
import { MONTHLY_PRODUCTION_BY_BLOCK } from './uretim';

export interface UpWeekDay {
  readonly date: Date;
  readonly day: number;
  readonly month: number; // 0-11
  readonly isSunday: boolean;
}

export interface UpWeek {
  readonly weekNumber: number; // 1-based, 1..53
  readonly days: readonly UpWeekDay[]; // Sun..Sat
  readonly repMonth: number; // representative month (the week's Thursday)
}

function generateWeeks(year: number, count = 53): UpWeek[] {
  const jan1 = new Date(year, 0, 1);
  const start = new Date(jan1);
  start.setDate(jan1.getDate() - jan1.getDay()); // rewind to preceding Sunday

  const weeks: UpWeek[] = [];
  for (let w = 0; w < count; w++) {
    const days: UpWeekDay[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + w * 7 + d);
      days.push({ date: dt, day: dt.getDate(), month: dt.getMonth(), isSunday: d === 0 });
    }
    weeks.push({ weekNumber: w + 1, days, repMonth: days[4].month });
  }
  return weeks;
}

export const UP_YEAR = 2026;
export const UP_WEEKS: readonly UpWeek[] = generateWeeks(UP_YEAR);

/** Distribute a block's monthly totals evenly across the weeks that "belong"
 * to each month (by representative day), giving a plausible weekly curve. */
function buildWeeklyPlan(blockId: string): number[] {
  const monthly = MONTHLY_PRODUCTION_BY_BLOCK[blockId] ?? new Array(12).fill(0);
  const weekIdxByMonth: number[][] = Array.from({ length: 12 }, () => []);
  UP_WEEKS.forEach((w, idx) => weekIdxByMonth[w.repMonth].push(idx));

  const plan = new Array(UP_WEEKS.length).fill(0);
  monthly.forEach((amount, m) => {
    const idxs = weekIdxByMonth[m];
    if (idxs.length === 0 || amount === 0) return;
    const perWeek = amount / idxs.length;
    idxs.forEach((idx) => { plan[idx] = perWeek; });
  });
  return plan;
}

export const UP_WEEKLY_PLAN_BY_BLOCK: Record<string, number[]> = Object.fromEntries(
  SERA_BLOCKS.map((b) => [b.id, buildWeeklyPlan(b.id)]),
);

/** Exact reference figures (source screenshot) for Dusak A / Ocak — override
 * the seasonal approximation for these 6 weeks so the page reproduces the
 * source numbers precisely (they sum to the 382.725 kg Ocak total used by
 * `Uretim.tsx`). Every other block/week keeps the derived seasonal split. */
const DUS_A_REFERENCE: Readonly<Record<number, number>> = {
  0: 120000, 1: 66633.17, 2: 74728.39, 3: 52012.8, 4: 69350.4, 52: 0,
};
Object.entries(DUS_A_REFERENCE).forEach(([weekIdx, value]) => {
  UP_WEEKLY_PLAN_BY_BLOCK['DUS-A'][Number(weekIdx)] = value;
});

export interface IzinGunu {
  readonly date: string; // 'YYYY-MM-DD'
  readonly label: string;
}

export const UP_DEFAULT_IZIN_GUNLERI: readonly IzinGunu[] = [
  { date: '2026-01-01', label: 'bayramcylyk' },
];
