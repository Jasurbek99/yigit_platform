import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from '@/i18n';
import SheetTruckSelectEditor from './SheetTruckSelectEditor';

const createHead = vi.fn();
const createTrailer = vi.fn();
vi.mock('@/hooks/useFleet', () => ({
  useTruckHeads: () => ({
    data: [
      { id: 1, plate_number: '01ABC' },
      { id: 2, plate_number: '02DEF' },
    ],
  }),
  useTrailers: () => ({
    data: [
      { id: 10, plate_number: 'T-100' },
      { id: 11, plate_number: 'T-200' },
    ],
  }),
  useCreateTruckHead: () => ({ mutateAsync: createHead, isPending: false }),
  useCreateTrailer: () => ({ mutateAsync: createTrailer, isPending: false }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('SheetTruckSelectEditor', () => {
  beforeAll(async () => {
    // Pin language so label/text assertions match the real en.json values,
    // same reasoning as ShipmentTruckSelector.test.tsx.
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    createHead.mockReset();
    createTrailer.mockReset();
    toastError.mockReset();
  });

  it('renders a head select, a trailer select, and a Done button', () => {
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialTrailerId={null}
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Truck (tractor)')).toBeInTheDocument();
    expect(screen.getByLabelText('Trailer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('selecting a head and trailer then clicking Done commits the composed plate once', async () => {
    const onCommit = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(headSelect);
    await userEvent.click(await screen.findByText('01ABC'));

    const trailerSelect = screen.getByLabelText('Trailer');
    await userEvent.click(trailerSelect);
    await userEvent.click(await screen.findByText('T-100'));

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      truck_head_id: 1,
      trailer_id: 10,
      truck_plate: '01ABC/T-100',
    });

    // Commit-once guard: clicking Done again must not fire onCommit a second time.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Escape closes without committing, even after a pending (unsaved) selection', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={1}
        initialTrailerId={10}
        onCommit={onCommit}
        onClose={onClose}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(headSelect);
    await userEvent.click(await screen.findByText('02DEF'));

    // Dispatch on the real focused element (the select's search input) to
    // exercise the actual DOM bubbling path up to the panel's onKeyDown,
    // not just a direct call on the container.
    fireEvent.keyDown(headSelect, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clicking outside the panel commits the pending selection', async () => {
    const onCommit = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(headSelect);
    await userEvent.click(await screen.findByText('01ABC'));

    fireEvent.mouseDown(document.body);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      truck_head_id: 1,
      trailer_id: null,
      truck_plate: '01ABC',
    });
  });

  it('inline add creates a truck head then commits a plate starting with the new plate', async () => {
    createHead.mockResolvedValue({ id: 99, plate_number: '09NEW' });
    const onCommit = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(headSelect);
    await userEvent.type(headSelect, '09new');
    await userEvent.click(await screen.findByText(/add.*09new/i));

    await waitFor(() => expect(createHead).toHaveBeenCalledWith('09NEW'));

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].truck_plate).toMatch(/^09NEW/);
  });

  it('a manual pick after an inline-add supersedes the earlier created plate', async () => {
    createHead.mockResolvedValue({ id: 99, plate_number: '09NEW' });
    const onCommit = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    // Inline-add "09NEW" (a typo the operator then corrects)...
    await userEvent.click(headSelect);
    await userEvent.type(headSelect, '09new');
    await userEvent.click(await screen.findByText(/add.*09new/i));
    await waitFor(() => expect(createHead).toHaveBeenCalledWith('09NEW'));

    // ...then reopens and picks a real fleet option instead.
    await userEvent.click(headSelect);
    await userEvent.click(await screen.findByText('02DEF'));

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    // The committed plate must reflect the LAST pick (02DEF), not the
    // stale remembered "09NEW" from the earlier inline-add.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      truck_head_id: 2,
      trailer_id: null,
      truck_plate: '02DEF',
    });
  });

  it('shows a toast error when inline add fails', async () => {
    createHead.mockRejectedValue(new Error('boom'));
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialTrailerId={null}
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(headSelect);
    await userEvent.type(headSelect, '09new');
    await userEvent.click(await screen.findByText(/add.*09new/i));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });
});
