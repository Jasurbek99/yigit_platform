import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { NotificationBell } from './NotificationBell';
import type { INotification } from '@/types';

const WEEKLY_PLAN_ROW: INotification = {
  id: 1,
  kind: 'weekly_plan_summary',
  message: 'W39/2026: 50% · Maral 25% (B, C) · Toyly 100%',
  link: '/export/plan?week=39&year=2026',
  read_at: null,
  created_at: '2026-09-19T09:00:00+05:00',
};

// Mutable so each test can set the rows the bell renders. The vi.mock factory
// closes over this binding, so reassigning it before render is enough.
let notifications: INotification[] = [WEEKLY_PLAN_ROW];

const mockMarkOneRead = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ data: notifications }),
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkOneRead: () => ({ mutate: mockMarkOneRead, isPending: false }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

async function openBell(rows: INotification[]) {
  notifications = rows;
  render(<NotificationBell />);
  await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
}

describe('NotificationBell', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    notifications = [WEEKLY_PLAN_ROW];
    mockMarkOneRead.mockClear();
    mockNavigate.mockClear();
  });

  it('prefixes the weekly plan summary with its translated label', async () => {
    await openBell([WEEKLY_PLAN_ROW]);
    expect(
      await screen.findByText(
        "Next week's harvest plan filled: W39/2026: 50% · Maral 25% (B, C) · Toyly 100%",
      ),
    ).toBeTruthy();
  });

  it('renders a tasks_changed notification with its translated label', async () => {
    await openBell([
      {
        id: 2,
        kind: 'tasks_changed',
        message: '2309002/26: +1 -1 ~0',
        link: '/shipments/42',
        read_at: null,
        created_at: '2026-09-24T09:00:00+05:00',
      },
    ]);

    expect(
      await screen.findByText(
        'Task list changed for this shipment — 2309002/26: +1 -1 ~0',
      ),
    ).toBeTruthy();
  });

  it('marks read and navigates when the notification has a link', async () => {
    await openBell([
      {
        id: 3,
        kind: 'tasks_changed',
        message: '2309003/26: +1 -1 ~0',
        link: '/shipments/43',
        read_at: null,
        created_at: '2026-09-24T09:00:00+05:00',
      },
    ]);

    await userEvent.click(
      await screen.findByText('Task list changed for this shipment — 2309003/26: +1 -1 ~0'),
    );

    expect(mockMarkOneRead).toHaveBeenCalledWith(3);
    expect(mockNavigate).toHaveBeenCalledWith('/shipments/43');
  });

  it('does not navigate when the notification has no link', async () => {
    await openBell([
      {
        id: 4,
        kind: 'task_done',
        message: 'no link here',
        link: null,
        read_at: null,
        created_at: '2026-09-24T09:00:00+05:00',
      },
    ]);

    await userEvent.click(await screen.findByText('no link here'));

    expect(mockMarkOneRead).toHaveBeenCalledWith(4);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
