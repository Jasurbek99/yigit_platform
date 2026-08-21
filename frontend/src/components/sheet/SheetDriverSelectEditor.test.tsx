import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from '@/i18n';
import SheetDriverSelectEditor from './SheetDriverSelectEditor';

const createDriver = vi.fn();
vi.mock('@/hooks/useFleet', () => ({
  useDrivers: () => ({
    data: [
      { id: 5, name: 'ABRAY ANNAKULYYEW', phone: null, is_active: true },
      { id: 7, name: 'ARNAGELDIYEW ALLAYAR', phone: null, is_active: true },
    ],
  }),
  useCreateDriver: () => ({ mutateAsync: createDriver, isPending: false }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('SheetDriverSelectEditor', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    createDriver.mockReset();
    toastError.mockReset();
  });

  it('renders a driver select and a Done button', () => {
    wrap(<SheetDriverSelectEditor initialDriverId={null} onCommit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Driver name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('picking a driver then Done commits driver_id + driver_name once, and NOT driver_phone', async () => {
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ARNAGELDIYEW ALLAYAR'));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    // Exact-payload assertion: R28 driver_phone is its own cell with its own
    // history and holds operator-typed values — picking a driver must never
    // reach across and write it.
    expect(onCommit).toHaveBeenCalledWith({ driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR' });

    // Commit-once guard.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Done with an unchanged selection closes without committing', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={5} onCommit={onCommit} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes without committing, even after a pending selection', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={5} onCommit={onCommit} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ARNAGELDIYEW ALLAYAR'));

    fireEvent.keyDown(screen.getByTestId('sheet-driver-select-editor'), { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();

    // A late outside-click must not resurrect the cancelled selection.
    fireEvent.mouseDown(document.body);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clicking outside the panel commits the pending selection', async () => {
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ABRAY ANNAKULYYEW'));

    fireEvent.mouseDown(document.body);
    expect(onCommit).toHaveBeenCalledWith({ driver_id: 5, driver_name: 'ABRAY ANNAKULYYEW' });
  });

  it('scrolling the grid commits the pending selection', async () => {
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ABRAY ANNAKULYYEW'));

    fireEvent.scroll(document.body);
    expect(onCommit).toHaveBeenCalledWith({ driver_id: 5, driver_name: 'ABRAY ANNAKULYYEW' });
  });

  it('inline add upper-cases the typed name, creates the driver, and commits it', async () => {
    createDriver.mockResolvedValue({ id: 200, name: 'TEST SURUJI', phone: null, is_active: true });
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.type(screen.getByLabelText('Driver name'), 'test suruji');
    await userEvent.click(await screen.findByRole('button', { name: /Add driver "TEST SURUJI"/ }));

    expect(createDriver).toHaveBeenCalledWith('TEST SURUJI');

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).toHaveBeenCalledWith({ driver_id: 200, driver_name: 'TEST SURUJI' });
  });

  it('a manual pick after an inline-add supersedes the created name', async () => {
    createDriver.mockResolvedValue({ id: 200, name: 'TEST SURUJI', phone: null, is_active: true });
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.type(screen.getByLabelText('Driver name'), 'test suruji');
    await userEvent.click(await screen.findByRole('button', { name: /Add driver "TEST SURUJI"/ }));

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ABRAY ANNAKULYYEW'));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledWith({ driver_id: 5, driver_name: 'ABRAY ANNAKULYYEW' });
  });

  it('shows a toast error when inline add fails', async () => {
    createDriver.mockRejectedValue(new Error('boom'));
    wrap(<SheetDriverSelectEditor initialDriverId={null} onCommit={vi.fn()} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.type(screen.getByLabelText('Driver name'), 'test suruji');
    await userEvent.click(await screen.findByRole('button', { name: /Add driver "TEST SURUJI"/ }));

    expect(toastError).toHaveBeenCalled();
  });
});
