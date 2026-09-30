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
