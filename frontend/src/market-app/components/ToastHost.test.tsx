import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastHost } from './ToastHost';
import { hideToast, showToast } from './toastStore';

describe('ToastHost', () => {
  afterEach(() => {
    act(() => hideToast());
    vi.useRealTimers();
  });

  it('shows the latest toast and hides it after 3.5 s', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => showToast({ text: 'first' }));
    act(() => showToast({ text: 'Сохранено' }));
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено');
    expect(screen.queryByText('first')).toBeNull();
    act(() => vi.advanceTimersByTime(3400));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a toast with an action for 7 s; the action hides it and runs once', () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    render(<ToastHost />);
    act(() => showToast({ text: 'Сохранено', actionLabel: 'Отменить', onAction }));
    act(() => vi.advanceTimersByTime(6000));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('honours a custom duration', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => showToast({ text: 'долго', ms: 20000 }));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
