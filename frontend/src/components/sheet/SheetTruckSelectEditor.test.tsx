import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  // ShipmentDriverSelector -> DriverSelect pulls the registry hooks.
  useDrivers: () => ({ data: [{ id: 5, name: 'ABRAY ANNAKULYYEW', phone: null, is_active: true }] }),
  useCreateDriver: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

/** jsdom returns an all-zero rect; build a real one so anchoring is assertable. */
function rectAt({ top, bottom, left }: { top: number; bottom: number; left: number }): DOMRect {
  return {
    top, bottom, left, right: left + 120, width: 120, height: bottom - top,
    x: left, y: top, toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Open one Select and click an option inside ITS dropdown.
 *
 * Both head Selects list the same plates and antd keeps a dropdown mounted
 * after it closes, so a bare getByText('02DEF') matches two nodes. Exactly one
 * dropdown is un-hidden at a time, which makes it the unambiguous scope.
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

/** Find the antd clear ("x") icon scoped to one specific Select, by its aria-label. */
function clearIconFor(ariaLabel: string): HTMLElement {
  const input = screen.getByLabelText(ariaLabel);
  const clear = input.closest('.ant-select')?.querySelector('.ant-select-clear');
  if (!clear) throw new Error(`No clear icon found for "${ariaLabel}" — does it have a value?`);
  return clear as HTMLElement;
}

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
        initialHead2Id={null}
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
        initialHead2Id={null}
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
      truck_head_2_id: null,
      truck_plate_2: '',
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
        initialHead2Id={null}
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
        initialHead2Id={null}
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
      truck_head_2_id: null,
      truck_plate_2: '',
    });
  });

  // A truck can run with two heads: the head is exchanged mid-route
  // (transshipment or a border swap) while the trailer stays with the load.
  // There is deliberately no second trailer.
  describe('second head', () => {
    it('renders a second head select beside the first', () => {
      wrap(
        <SheetTruckSelectEditor
          initialHeadId={null}
          initialHead2Id={null}
          initialTrailerId={null}
          onCommit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Truck (tractor)')).toBeInTheDocument();
      expect(screen.getByLabelText('Truck (tractor) 2')).toBeInTheDocument();
      expect(screen.getByLabelText('Trailer')).toBeInTheDocument();
    });

    it('commits the second head as its own plate, not folded into the first', async () => {
      const onCommit = vi.fn();
      wrap(
        <SheetTruckSelectEditor
          initialHeadId={null}
          initialHead2Id={null}
          initialTrailerId={null}
          onCommit={onCommit}
          onClose={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByLabelText('Truck (tractor)'));
      await userEvent.click(await screen.findByText('01ABC'));
      await userEvent.click(screen.getByLabelText('Trailer'));
      await userEvent.click(await screen.findByText('T-100'));
      await pickIn('Truck (tractor) 2', '02DEF');
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith({
        truck_head_id: 1,
        trailer_id: 10,
        truck_plate: '01ABC/T-100',
        truck_head_2_id: 2,
        truck_plate_2: '02DEF',
      });
    });

    it('commits a change to the second head alone', async () => {
      const onCommit = vi.fn();
      wrap(
        <SheetTruckSelectEditor
          initialHeadId={1}
          initialHead2Id={null}
          initialTrailerId={10}
          onCommit={onCommit}
          onClose={vi.fn()}
        />,
      );
      await pickIn('Truck (tractor) 2', '02DEF');
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(onCommit).toHaveBeenCalledWith({
        truck_head_id: 1,
        trailer_id: 10,
        truck_plate: '01ABC/T-100',
        truck_head_2_id: 2,
        truck_plate_2: '02DEF',
      });
    });

    it('sends a blank second plate when the second head is cleared', async () => {
      const onCommit = vi.fn();
      wrap(
        <SheetTruckSelectEditor
          initialHeadId={1}
          initialHead2Id={2}
          initialTrailerId={10}
          onCommit={onCommit}
          onClose={vi.fn()}
        />,
      );
      await userEvent.click(clearIconFor('Truck (tractor) 2'));
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(onCommit).toHaveBeenCalledWith({
        truck_head_id: 1,
        trailer_id: 10,
        truck_plate: '01ABC/T-100',
        truck_head_2_id: null,
        truck_plate_2: '',
      });
    });

    it('Done with nothing touched still closes without committing', async () => {
      const onCommit = vi.fn();
      const onClose = vi.fn();
      wrap(
        <SheetTruckSelectEditor
          initialHeadId={1}
          initialHead2Id={2}
          initialTrailerId={10}
          onCommit={onCommit}
          onClose={onClose}
        />,
      );
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
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialHead2Id={null}
        initialTrailerId={null}
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Truck (tractor)')).toHaveFocus();
  });

  it('scrolling the option list leaves the panel open mid-pick', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialHead2Id={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByLabelText('Truck (tractor)'));
    const dropdown = document.querySelector('.ant-select-dropdown');
    expect(dropdown).not.toBeNull();

    fireEvent.scroll(dropdown!);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet-truck-select-editor')).toBeInTheDocument();
  });

  it('scrolling the grid re-anchors the panel instead of closing it', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialHead2Id={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByLabelText('Truck (tractor)'));
    await userEvent.click(await screen.findByText('01ABC'));

    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rectAt({ top: 100, bottom: 120, left: 50 }),
    );
    fireEvent.scroll(document.body);
    rect.mockRestore();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const panel = screen.getByTestId('sheet-truck-select-editor');
    expect(panel.style.top).toBe('120px');
    expect(panel.style.left).toBe('50px');
  });

  it('commits and closes once the cell has scrolled out of the viewport', async () => {
    const onCommit = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialHead2Id={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByLabelText('Truck (tractor)'));
    await userEvent.click(await screen.findByText('01ABC'));

    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rectAt({ top: -80, bottom: -60, left: 50 }),
    );
    fireEvent.scroll(document.body);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      truck_head_id: 1,
      trailer_id: null,
      truck_plate: '01ABC',
      truck_head_2_id: null,
      truck_plate_2: '',
    });

    // Commit-once guard: a second scroll must not fire onCommit again.
    fireEvent.scroll(document.body);
    rect.mockRestore();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // The truck head's "+ Add" was removed on 2026-09-10 — a head needs a
  // `truck_model` now, which this one-line control cannot collect. The
  // trailer's inline add is untouched: it has no required field beyond a plate.
  it('offers no inline add for an unknown truck plate, and points at Fleet Management', async () => {
    const onCommit = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialHead2Id={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(headSelect);
    await userEvent.type(headSelect, '09new');

    expect(await screen.findByText(/Add the truck in Fleet Management/)).toBeInTheDocument();
    expect(screen.queryByText(/add truck/i)).not.toBeInTheDocument();
    expect(createHead).not.toHaveBeenCalled();
  });

  it('a manual pick after a typed-then-abandoned search commits the picked plate', async () => {
    const onCommit = vi.fn();
    wrap(
      <SheetTruckSelectEditor
        initialHeadId={null}
        initialHead2Id={null}
        initialTrailerId={null}
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    );
    const headSelect = screen.getByLabelText('Truck (tractor)');
    // Type a plate that is not in the fleet (a typo the operator corrects)...
    await userEvent.click(headSelect);
    await userEvent.type(headSelect, '09new');

    // ...then clears the typo and picks a real fleet option instead. The clear
    // matters: the typed text filters the option list down to nothing, and it
    // used to be wiped as a side effect of the inline-add that no longer exists.
    await userEvent.clear(headSelect);
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
      truck_head_2_id: null,
      truck_plate_2: '',
    });
  });

});
