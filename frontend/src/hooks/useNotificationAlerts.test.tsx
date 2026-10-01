import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import i18n from '@/i18n';
import type { INotification } from '@/types';
import { useNotificationAlerts } from './useNotificationAlerts';

const mockToast = vi.fn();
const mockPlaySound = vi.fn();
const mockMarkOneRead = vi.fn();
const mockNavigate = vi.fn();

vi.mock('sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));
vi.mock('@/utils/notificationSound', () => ({ playNotificationSound: () => mockPlaySound() }));
vi.mock('@/hooks/useNotifications', () => ({
  useMarkOneRead: () => ({ mutate: mockMarkOneRead, isPending: false }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function row(id: number, overrides: Partial<INotification> = {}): INotification {
  return {
    id,
    kind: 'mention',
    message: `message ${id}`,
    link: `/shipments/${id}`,
    read_at: null,
    created_at: '2026-10-01T10:00:00+05:00',
    ...overrides,
  };
}

function renderAlerts(initial: INotification[] | undefined) {
  return renderHook(({ rows }) => useNotificationAlerts(rows), {
    initialProps: { rows: initial },
  });
}

describe('useNotificationAlerts', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockToast.mockClear();
    mockPlaySound.mockClear();
    mockMarkOneRead.mockClear();
    mockNavigate.mockClear();
  });

  it('does not pop up what was already unread when the list first loads', () => {
    renderAlerts([row(2), row(1)]);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();
  });

  it('waits for the first real response before taking the baseline', () => {
    const { rerender } = renderAlerts(undefined);
    rerender({ rows: [row(2), row(1)] });
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();
  });

  it('toasts each new unread notification and chimes once per batch', () => {
    const { rerender } = renderAlerts([row(1)]);
    rerender({ rows: [row(3), row(2), row(1)] });
    expect(mockToast).toHaveBeenCalledTimes(2);
    expect(mockToast.mock.calls[0][0]).toBe('message 3');
    expect(mockToast.mock.calls[1][0]).toBe('message 2');
    expect(mockPlaySound).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a toast on the next poll', () => {
    const { rerender } = renderAlerts([row(1)]);
    rerender({ rows: [row(2), row(1)] });
    rerender({ rows: [row(2), row(1)] });
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockPlaySound).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a new row that is already read', () => {
    const { rerender } = renderAlerts([row(1)]);
    rerender({ rows: [row(2, { read_at: '2026-10-01T10:01:00+05:00' }), row(1)] });
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();
  });

  it('caps the pop-ups at three per batch', () => {
    const { rerender } = renderAlerts([row(1)]);
    rerender({ rows: [row(6), row(5), row(4), row(3), row(2), row(1)] });
    expect(mockToast).toHaveBeenCalledTimes(3);
    expect(mockPlaySound).toHaveBeenCalledTimes(1);
  });

  it('Open marks the notification read and goes to its link', () => {
    const { rerender } = renderAlerts([row(1)]);
    rerender({ rows: [row(2), row(1)] });
    const options = mockToast.mock.calls[0][1];
    expect(options.action.label).toBe('Open');
    options.action.onClick();
    expect(mockMarkOneRead).toHaveBeenCalledWith(2);
    expect(mockNavigate).toHaveBeenCalledWith('/shipments/2');
  });

  it('offers no Open button when the notification has no link', () => {
    const { rerender } = renderAlerts([row(1)]);
    rerender({ rows: [row(2, { link: null }), row(1)] });
    expect(mockToast.mock.calls[0][1].action).toBeUndefined();
  });
});
