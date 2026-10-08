import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from 'antd';
import i18n from '@/i18n';
import * as trips from '@/hooks/useExternalTrips';
import { TripPickerModal, tripCountryMismatch } from './TripPickerModal';

vi.mock('@/hooks/useExternalTrips');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const trip = (id: number, plate: string, country: string | null) => ({
  id, tractor_plate: plate, trailer_plate: `${plate}-T`, destination_country_code: country,
  driver_full_name: `Driver ${id}`, planned_departure: '2026-10-01T06:00:00Z',
});

function setup(list: object[]) {
  const mutate = vi.fn();
  vi.mocked(trips.useExternalTrips).mockReturnValue({ data: list, isLoading: false } as unknown as ReturnType<typeof trips.useExternalTrips>);
  vi.mocked(trips.useAssignTrip).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof trips.useAssignTrip>);
  render(<TripPickerModal shipment={{ id: 9, country_code: 'KZ' }} onClose={vi.fn()} />);
  return mutate;
}

describe('TripPickerModal', () => {
  it('flags a trip to another country as a mismatch', () => {
    expect(tripCountryMismatch('RU', 'KZ')).toBe(true);
    expect(tripCountryMismatch('KZ', 'KZ')).toBe(false);
    expect(tripCountryMismatch(null, 'KZ')).toBe(false);
  });

  it('disables a mismatched trip and assigns a matching one', () => {
    const mutate = setup([trip(1, '01AA', 'RU'), trip(2, '02BB', 'KZ')]);
    expect(screen.getByRole('radio', { name: /01AA/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /02BB/ }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('truck_board.assign') }));
    expect(mutate).toHaveBeenCalledWith(
      { tripId: 2, shipmentId: 9, confirmUnknownCountry: false }, expect.anything(),
    );
  });

  it('shows a rejected trip with its reason and does not let it be picked', () => {
    setup([{ ...trip(4, '04DD', 'KZ'), rejected_at: '2026-10-07T10:00:00Z', rejection_reason: 'No KZ visa' }]);
    expect(screen.getByRole('radio', { name: /04DD/ })).toBeDisabled();
    expect(screen.getByText('Rejected: No KZ visa')).toBeInTheDocument();
  });

  it('unknown country asks first, then sends the confirm flag', () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((cfg) => {
      cfg.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as unknown as ReturnType<typeof Modal.confirm>;
    });
    const mutate = setup([trip(3, '03CC', null)]);
    fireEvent.click(screen.getByRole('radio', { name: /03CC/ }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('truck_board.assign') }));
    expect(confirm).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith(
      { tripId: 3, shipmentId: 9, confirmUnknownCountry: true }, expect.anything(),
    );
    confirm.mockRestore();
  });

  it('says so when there is no free trip', () => {
    setup([]);
    expect(screen.getByText(i18n.t('shipment_detail.parts.no_free_trips'))).toBeInTheDocument();
  });
});
