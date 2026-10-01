import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMarkOneRead } from '@/hooks/useNotifications';
import type { INotification } from '@/types';
import { notificationText } from '@/utils/notificationText';
import { playNotificationSound } from '@/utils/notificationSound';

const MAX_TOASTS_PER_BATCH = 3;

/**
 * Pops a toast and plays one chime for notifications that arrive while the
 * app is open. The first loaded list is the baseline: whatever was already
 * unread at page load stays in the bell and does not pop up.
 *
 * Reacts to the query data, not to the poll — anything that refreshes the
 * `['notifications']` query (poll, invalidate, a future WS push) feeds it.
 */
export function useNotificationAlerts(notifications: INotification[] | undefined): void {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markOneRead = useMarkOneRead();
  const seenIds = useRef<Set<number> | null>(null);

  useEffect(() => {
    // `undefined` = no response yet. Seeding from an empty placeholder would
    // make the first real fetch pop up every old unread notification.
    if (!notifications) return;
    if (seenIds.current === null) {
      seenIds.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const seen = seenIds.current;
    const fresh = notifications.filter((n) => !n.read_at && !seen.has(n.id));
    notifications.forEach((n) => seen.add(n.id));
    if (fresh.length === 0) return;

    playNotificationSound();
    fresh.slice(0, MAX_TOASTS_PER_BATCH).forEach((n) => {
      const link = n.link;
      toast(notificationText(n, t), {
        action: link
          ? {
              label: t('notifications.open'),
              onClick: () => {
                markOneRead.mutate(n.id);
                navigate(link);
              },
            }
          : undefined,
      });
    });
  }, [notifications, t, navigate, markOneRead]);
}
