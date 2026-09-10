import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from '@/i18n';
import SheetDriverSelectEditor from './SheetDriverSelectEditor';

const createDriver = vi.fn();
vi.mock('@/hooks/useFleet', () => ({
  useDrivers: () => ({
    data: [
      { id: 5, name: 'ABRAY ANNAKULYYEW', phone: null, logo_ref: '318',
        driver_logo_code: '195.02.A001', is_active: true },
      { id: 7, name: 'ARNAGELDIYEW ALLAYAR', phone: '+99365777888', logo_ref: '337',
        driver_logo_code: '195.02.A003', is_active: true },
    ],
  }),
  useCreateDriver: () => ({ mutateAsync: createDriver, isPending: false }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

/**
 * Open one Select and click an option inside ITS dropdown. Both driver Selects
 * list the same registry and antd keeps a dropdown mounted after it closes, so
 * a bare getByText matches two nodes. Exactly one dropdown is un-hidden.
 */
async function pickIn(ariaLabel: string, text: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(ariaLabel));
  const open = Array.from(document.querySelectorAll('.ant-select-dropdown')).filter(
    (d) => !d.classList.contains('ant-select-dropdown-hidden'),
  );
  const dropdown = open[open.length - 1];
  if (!dropdown) throw new Error(`No open dropdown for "${ariaLabel}"`);
  await userEvent.click(within(dropdown as HTMLElement).getByText(text));
}

/** jsdom returns an all-zero rect; build a real one so anchoring is assertable. */
function rectAt({ top, bottom, left }: { top: number; bottom: number; left: number }): DOMRect {
  return {
    top, bottom, left, right: left + 120, width: 120, height: bottom - top,
    x: left, y: top, toJSON: () => ({}),
  } as DOMRect;
}

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
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Driver name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('picking a driver then Done commits id + name, and the registry phone when there is one', async () => {
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ARNAGELDIYEW ALLAYAR'));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR', driver_phone: '+99365777888',
    });

    // Commit-once guard.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Done with an unchanged selection closes without committing', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={5} initialDriver2Id={null} onCommit={onCommit} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes without committing, even after a pending selection', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={5} initialDriver2Id={null} onCommit={onCommit} onClose={onClose} />);

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
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ABRAY ANNAKULYYEW'));

    fireEvent.mouseDown(document.body);
    // Driver 5 has no registry phone, so driver_phone is absent — R28 keeps
    // whatever the operator typed.
    expect(onCommit).toHaveBeenCalledWith({ driver_id: 5, driver_name: 'ABRAY ANNAKULYYEW' });
  });

  it('swapping in a driver the registry has no phone for blanks R28', async () => {
    // Otherwise the row would name the new driver and carry the old one's
    // number: the operator typed it for driver 7, and driver 7 is gone.
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={7} initialDriver2Id={null} onCommit={onCommit} onClose={vi.fn()} />);

    await pickIn('Driver name', 'ABRAY ANNAKULYYEW');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledWith({
      driver_id: 5, driver_name: 'ABRAY ANNAKULYYEW', driver_phone: '',
    });
  });

  // Long legs to Kazakhstan and Russia run with two drivers; both are named on
  // the invoice and the CMR, so both are recorded here.
  describe('second driver', () => {
    it('renders a second driver select beside the first', () => {
      wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByLabelText('Driver name')).toBeInTheDocument();
      expect(screen.getByLabelText('Driver name 2')).toBeInTheDocument();
    });

    it('commits both drivers, each with its own registry phone', async () => {
      const onCommit = vi.fn();
      wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={onCommit} onClose={vi.fn()} />);

      await pickIn('Driver name', 'ABRAY ANNAKULYYEW');
      await pickIn('Driver name 2', 'ARNAGELDIYEW ALLAYAR');
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));

      // Driver 5 has no registry phone, so driver_phone is absent and R28 keeps
      // whatever the operator typed; driver 7 has one, so it is written.
      expect(onCommit).toHaveBeenCalledWith({
        driver_id: 5,
        driver_name: 'ABRAY ANNAKULYYEW',
        driver_2_id: 7,
        driver_2_name: 'ARNAGELDIYEW ALLAYAR',
        driver_2_phone: '+99365777888',
      });
    });

    it('changing only the second driver leaves the first one out of the payload', async () => {
      // The name comes from the picker's callback, not from a lookup, so an
      // untouched slot has no name in local state. Sending it would write a
      // blank over the driver already on the shipment.
      const onCommit = vi.fn();
      wrap(<SheetDriverSelectEditor initialDriverId={5} initialDriver2Id={null} onCommit={onCommit} onClose={vi.fn()} />);

      await pickIn('Driver name 2', 'ARNAGELDIYEW ALLAYAR');
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(onCommit).toHaveBeenCalledWith({
        driver_2_id: 7,
        driver_2_name: 'ARNAGELDIYEW ALLAYAR',
        driver_2_phone: '+99365777888',
      });
    });

    it('clearing the second driver blanks its name rather than dropping it', async () => {
      const onCommit = vi.fn();
      wrap(<SheetDriverSelectEditor initialDriverId={5} initialDriver2Id={7} onCommit={onCommit} onClose={vi.fn()} />);

      const input = screen.getByLabelText('Driver name 2');
      const clear = input.closest('.ant-select')?.querySelector('.ant-select-clear');
      await userEvent.click(clear as HTMLElement);
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(onCommit).toHaveBeenCalledWith({ driver_2_id: null, driver_2_name: '' });
    });

    it('swapping the second driver for one with no registry phone blanks its phone too', async () => {
      const onCommit = vi.fn();
      wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={7} onCommit={onCommit} onClose={vi.fn()} />);

      await pickIn('Driver name 2', 'ABRAY ANNAKULYYEW');
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(onCommit).toHaveBeenCalledWith({
        driver_2_id: 5, driver_2_name: 'ABRAY ANNAKULYYEW', driver_2_phone: '',
      });
    });

    it('Done with neither driver touched closes without committing', async () => {
      const onCommit = vi.fn();
      const onClose = vi.fn();
      wrap(<SheetDriverSelectEditor initialDriverId={5} initialDriver2Id={7} onCommit={onCommit} onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(onCommit).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // A visible field label was added above this select (2026-09-10). It must not
  // displace the caret: SheetCellEditor's mount-time auto-focus reaches only DOM
  // descendants of the cell, and this input is portaled out, so the editor's own
  // `autoFocus` is the only thing putting the caret in the first picker.
  it('puts the caret in the first picker on open, label notwithstanding', () => {
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Driver name')).toHaveFocus();
  });

  it('scrolling the option list leaves the panel open mid-pick', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={onCommit} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    const dropdown = document.querySelector('.ant-select-dropdown');
    expect(dropdown).not.toBeNull();

    fireEvent.scroll(dropdown!);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet-driver-select-editor')).toBeInTheDocument();
  });

  it('scrolling the grid re-anchors the panel instead of closing it', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={onCommit} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ABRAY ANNAKULYYEW'));

    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rectAt({ top: 100, bottom: 120, left: 50 }),
    );
    fireEvent.scroll(document.body);
    rect.mockRestore();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const panel = screen.getByTestId('sheet-driver-select-editor');
    expect(panel.style.top).toBe('120px');
    expect(panel.style.left).toBe('50px');
  });

  it('commits and closes once the cell has scrolled out of the viewport', async () => {
    const onCommit = vi.fn();
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.click(await screen.findByText('ABRAY ANNAKULYYEW'));

    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rectAt({ top: -80, bottom: -60, left: 50 }),
    );
    fireEvent.scroll(document.body);

    expect(onCommit).toHaveBeenCalledWith({ driver_id: 5, driver_name: 'ABRAY ANNAKULYYEW' });

    // Commit-once guard: a second scroll must not fire onCommit again.
    fireEvent.scroll(document.body);
    rect.mockRestore();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // An unknown name used to offer an inline "+ Add driver" button here. A
  // driver now needs a passport serial and issue date to exist at all, which
  // this one-line control cannot collect, so the button was removed (2026-09-10)
  // and the dropdown points at Fleet Management instead.
  it('offers no inline add for an unknown name, and points at Fleet Management', async () => {
    wrap(<SheetDriverSelectEditor initialDriverId={null} initialDriver2Id={null} onCommit={vi.fn()} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Driver name'));
    await userEvent.type(screen.getByLabelText('Driver name'), 'test suruji');

    expect(await screen.findByText(/Add the driver in Fleet Management/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add driver/ })).not.toBeInTheDocument();
    expect(createDriver).not.toHaveBeenCalled();
  });
});
