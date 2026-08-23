import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from '@/i18n';
import type { IShipmentDetail } from '@/types';
import { ShipmentDriverSelector } from './ShipmentDriverSelector';

const mutate = vi.fn();
vi.mock('@/hooks/useShipmentPatch', () => ({
  useShipmentPatchMulti: () => ({ mutate }),
}));

const createDriver = vi.fn().mockResolvedValue({ id: 200, name: 'TEST SURUJI', phone: null, is_active: true });
vi.mock('@/hooks/useFleet', () => ({
  useDrivers: () => ({
    data: [
      { id: 5, name: 'ABRAY ANNAKULYYEW', phone: null, is_active: true },
      { id: 7, name: 'ARNAGELDIYEW ALLAYAR', phone: null, is_active: true },
    ],
  }),
  useCreateDriver: () => ({ mutateAsync: createDriver, isPending: false }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function shipmentWith(driverId: number | null): IShipmentDetail {
  return { id: 7, driver_id: driverId, driver_name: '', is_gapy_satys: false } as unknown as IShipmentDetail;
}

const LABEL = 'Driver name';

describe('ShipmentDriverSelector', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mutate.mockClear();
    createDriver.mockClear();
  });

  it('picking a driver PATCHes driver_id and driver_name together', async () => {
    wrap(<ShipmentDriverSelector shipment={shipmentWith(null)} readOnly={false} />);

    await userEvent.click(screen.getByLabelText(LABEL));
    await userEvent.click(await screen.findByText('ARNAGELDIYEW ALLAYAR'));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      id: 7,
      fields: { driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR' },
    });
  });

  it('clearing nulls the id AND blanks the name — never one without the other', async () => {
    // The inverse of the bug this component exists to fix: a cleared link left
    // under a stale name reads as "driver known" while pointing at nobody.
    wrap(<ShipmentDriverSelector shipment={shipmentWith(5)} readOnly={false} />);

    const clear = screen.getByLabelText(LABEL).closest('.ant-select')?.querySelector('.ant-select-clear');
    expect(clear).toBeTruthy();
    await userEvent.click(clear as HTMLElement);

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({ id: 7, fields: { driver_id: null, driver_name: '' } }),
    );
  });

  it('re-picking the driver already set does not PATCH', async () => {
    wrap(<ShipmentDriverSelector shipment={shipmentWith(5)} readOnly={false} />);

    await userEvent.click(screen.getByLabelText(LABEL));
    // The name is on screen twice — the closed select's display value and the
    // dropdown option — so scope to the option.
    await userEvent.click(await screen.findByRole('option', { name: 'ABRAY ANNAKULYYEW' }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('inline add creates the driver upper-cased and PATCHes it in one go', async () => {
    wrap(<ShipmentDriverSelector shipment={shipmentWith(null)} readOnly={false} />);

    await userEvent.click(screen.getByLabelText(LABEL));
    await userEvent.type(screen.getByLabelText(LABEL), 'test suruji');
    await userEvent.click(await screen.findByRole('button', { name: /Add driver "TEST SURUJI"/ }));

    expect(createDriver).toHaveBeenCalledWith('TEST SURUJI');
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 7,
        fields: { driver_id: 200, driver_name: 'TEST SURUJI' },
      }),
    );
  });

  it('readOnly disables the select', () => {
    wrap(<ShipmentDriverSelector shipment={shipmentWith(5)} readOnly />);
    expect(screen.getByLabelText(LABEL)).toBeDisabled();
  });
});
