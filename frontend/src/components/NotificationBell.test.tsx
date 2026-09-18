import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { NotificationBell } from './NotificationBell';
import type { INotification } from '@/types';

const notifications: INotification[] = [
  {
    id: 1,
    kind: 'weekly_plan_summary',
    message: 'W39/2026: 50% · Maral 25% (B, C) · Toyly 100%',
    link: '/export/plan?week=39&year=2026',
    read_at: null,
    created_at: '2026-09-19T09:00:00+05:00',
  },
];

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ data: notifications }),
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('NotificationBell', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('prefixes the weekly plan summary with its translated label', async () => {
    render(<NotificationBell />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(
      await screen.findByText(
        "Next week's harvest plan filled: W39/2026: 50% · Maral 25% (B, C) · Toyly 100%",
      ),
    ).toBeTruthy();
  });
});
