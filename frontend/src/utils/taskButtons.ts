import type { TFunction } from 'i18next';

/**
 * Tasks closed by a button: `manual_done` (never holds the step) and `confirm`
 * (holds the step until pressed — the PREP/DOCS chain, spec 2026-09-30).
 */
export function isButtonTask(completionRule: string): boolean {
  return completionRule === 'manual_done' || completionRule === 'confirm';
}

/** The task's own button text («Çap etdim», «Ugradyldy», …), else «Mark done». */
export function taskButtonLabel(t: TFunction, titleKey: string): string {
  return t(`tasks.button.${titleKey.replace(/^tasks\./, '')}`, {
    defaultValue: t('shipment.detail.mark_done'),
  });
}

/** Tasks done on another page: the card links there (join the packing on the
 * Assignment board, join a Planning trip on the Truck Board, link the advance
 * on the Advances page). */
const TASK_LINKS: Record<string, { to: string; labelKey: string }> = {
  'tasks.join_supply': { to: '/export/assign', labelKey: 'tasks.open_assign_board' },
  'tasks.choose_truck': { to: '/export/truck-board', labelKey: 'nav.truck_board' },
  'tasks.give_advance': { to: '/export/advances', labelKey: 'nav.advances' },
};

export function taskLink(titleKey: string): { to: string; labelKey: string } | null {
  return TASK_LINKS[titleKey] ?? null;
}
