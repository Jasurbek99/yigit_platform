import type { TFunction } from 'i18next';
import type { IDailyProgressDay } from '@/types';

/** daily_export card line: «Russia 3/4 · Gapy Satys 1/1 · packing 3/4». */
export function exportProgressLine(day: IDailyProgressDay, t: TFunction): string {
  const rows = day.rows.map((r) => `${r.label} ${r.fact}/${r.plan}`);
  const packing = t('tasks.progress_packing', { done: day.export_parts_packed, total: day.export_parts });
  return [...rows, packing].join(' · ');
}

/** daily_loading card line: «Packed 3 of 6». */
export function loadingProgressLine(day: IDailyProgressDay, t: TFunction): string {
  return t('tasks.progress_packed', { done: day.packed, total: day.loading_target });
}
