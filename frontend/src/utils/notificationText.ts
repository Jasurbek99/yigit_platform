import type { TFunction } from 'i18next';
import type { INotification } from '@/types';

/** One notification's display line — shared by the bell list and the pop-up toast. */
export function notificationText(n: INotification, t: TFunction): string {
  if (n.kind === 'action_required') return t('notifications.action_required', { shipment_code: n.message });
  // The message is language-neutral ("W39/2026: 78% · Maral 25% (B, C) · …").
  if (n.kind === 'weekly_plan_summary') return `${t('notifications.weekly_plan_summary')} ${n.message}`;
  if (n.kind === 'gate_arrival') return `${t('notifications.gate_arrival')} ${n.message}`;
  // The counts are language-neutral ("2309002/26: +1 -1 ~0").
  if (n.kind === 'tasks_changed') return `${t('notifications.tasks_changed')} — ${n.message}`;
  return n.message;
}
