import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from '@/i18n';
import { ShipmentTruckSelector } from './ShipmentTruckSelector';

const mutate = vi.fn();
vi.mock('@/hooks/useShipmentPatch', () => ({
  useShipmentPatchMulti: () => ({ mutate }),
}));
const createHead = vi.fn().mockResolvedValue({ id: 300, plate_number: '5555AHF', has_gps: false });
const createTrailer = vi.fn().mockResolvedValue({ id: 301, plate_number: 'TR999XX', is_active: true });
vi.mock('@/hooks/useFleet', () => ({
  useTruckHeads: () => ({ data: [
    { id: 13, plate_number: '3269AHF', owner_type: 'company', status: 'idle', has_gps: true },
    { id: 14, plate_number: '4378AHF', owner_type: 'company', status: 'idle', has_gps: true },
  ] }),
  useTrailers: () => ({ data: [{ id: 1, plate_number: '2602TAH', owner_type: 'company', status: 'idle', is_active: true }] }),
  useCreateTruckHead: () => ({ mutateAsync: createHead, isPending: false }),
  useCreateTrailer: () => ({ mutateAsync: createTrailer, isPending: false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Find the antd clear ("x") icon scoped to one specific Select, by its aria-label. */
function clearIconFor(ariaLabel: string): HTMLElement {
  const input = screen.getByLabelText(ariaLabel);
  const clear = input.closest('.ant-select')?.querySelector('.ant-select-clear');
  if (!clear) throw new Error(`No clear icon found for "${ariaLabel}" — does it have a value?`);
  return clear as HTMLElement;
}

const shipment = { id: 7, truck_head_id: 13, trailer_id: 1, is_gapy_satys: false } as any;

describe('ShipmentTruckSelector', () => {
  beforeAll(async () => {
    // Pin language so label/aria-label assertions match the real en.json
    // values regardless of what the language-detector picks up from
    // happy-dom's navigator/cookie state (same reasoning as
    // DetailFieldRow.test.tsx / LoginPage.test.tsx).
    await i18n.changeLanguage('en');
  });

  beforeEach(() => mutate.mockClear());

  it('shows the current head + trailer and derives truck_plate on change', async () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={false} />);
    // change the truck head to 4378AHF
    const heads = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(heads);
    await userEvent.click(await screen.findByText('4378AHF'));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 7,
        fields: { truck_head_id: 14, trailer_id: 1, truck_plate: '4378AHF/2602TAH' },
      }),
    );
  });

  it('is read-only when readOnly', () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={true} />);
    expect(screen.getByLabelText('Truck (tractor)')).toBeDisabled();
  });

  it('clearing the truck head composes a bare trailer plate (no leading "/") and PATCHes truck_head_id: null', async () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={false} />);
    await userEvent.click(clearIconFor('Truck (tractor)'));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 7,
        fields: { truck_head_id: null, trailer_id: 1, truck_plate: '2602TAH' },
      }),
    );
  });

  it('clearing both head and trailer derives an empty truck_plate', async () => {
    // Head already unset — isolates the "trailer is the last field cleared"
    // case so the assertion doesn't depend on this controlled component
    // reflecting a prior clear back into its own `shipment` prop (it doesn't;
    // the prop is the single source of truth and this test double is static).
    const headAlreadyClear = { ...shipment, truck_head_id: null };
    wrap(<ShipmentTruckSelector shipment={headAlreadyClear} readOnly={false} />);
    await userEvent.click(clearIconFor('Trailer'));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 7,
        fields: { truck_head_id: null, trailer_id: null, truck_plate: '' },
      }),
    );
  });

  it('offers "+ Add" for an unknown plate and creates + selects it', async () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={false} />);
    // aria-label is the translated field label ("Truck (tractor)"), same as
    // the other tests in this file — not a literal "truck head" string.
    const heads = screen.getByLabelText('Truck (tractor)');
    await userEvent.click(heads);
    await userEvent.type(heads, '5555AHF');
    await userEvent.click(await screen.findByText(/add.*5555AHF/i));
    await waitFor(() => expect(createHead).toHaveBeenCalledWith('5555AHF'));
    // after create, the new id is saved onto the shipment, and truck_plate
    // is composed with the JUST-CREATED head's plate — not the stale
    // pre-refetch `heads` list (which doesn't contain id 300 yet).
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 7,
        fields: { truck_head_id: 300, trailer_id: 1, truck_plate: '5555AHF/2602TAH' },
      }),
    );
  });

  it('offers "+ Add" for an unknown trailer plate and creates + selects it', async () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={false} />);
    const trailer = screen.getByLabelText('Trailer');
    await userEvent.click(trailer);
    await userEvent.type(trailer, 'TR999XX');
    await userEvent.click(await screen.findByText(/add.*TR999XX/i));
    await waitFor(() => expect(createTrailer).toHaveBeenCalledWith('TR999XX'));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 7,
        fields: { truck_head_id: 13, trailer_id: 301, truck_plate: '3269AHF/TR999XX' },
      }),
    );
  });
});
