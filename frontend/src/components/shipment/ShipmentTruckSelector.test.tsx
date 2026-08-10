import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ShipmentTruckSelector } from './ShipmentTruckSelector';

const mutate = vi.fn();
vi.mock('@/hooks/useShipmentPatch', () => ({
  useShipmentPatchMulti: () => ({ mutate }),
}));
vi.mock('@/hooks/useFleet', () => ({
  useTruckHeads: () => ({ data: [
    { id: 13, plate_number: '3269AHF', owner_type: 'company', status: 'idle', has_gps: true },
    { id: 14, plate_number: '4378AHF', owner_type: 'company', status: 'idle', has_gps: true },
  ] }),
  useTrailers: () => ({ data: [{ id: 1, plate_number: '2602TAH', owner_type: 'company', status: 'idle', is_active: true }] }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const shipment = { id: 7, truck_head_id: 13, trailer_id: 1, is_gapy_satys: false } as any;

describe('ShipmentTruckSelector', () => {
  beforeEach(() => mutate.mockClear());

  it('shows the current head + trailer and derives truck_plate on change', async () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={false} />);
    // change the truck head to 4378AHF
    const heads = screen.getByLabelText(/truck head/i);
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
    expect(screen.getByLabelText(/truck head/i)).toBeDisabled();
  });
});
