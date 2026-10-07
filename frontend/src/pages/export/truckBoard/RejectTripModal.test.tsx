import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import * as trips from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { RejectTripModal } from './RejectTripModal';

vi.mock('@/hooks/useExternalTrips');

const mutate = vi.fn();
const trip = { id: 7, tractor_plate: '2563AHF', trailer_plate: '2251TAH' } as unknown as IExternalTrip;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  mutate.mockReset();
  vi.mocked(trips.useRejectTrip).mockReturnValue({ mutate, isPending: false } as any);
});

describe('RejectTripModal', () => {
  it('requires a reason', async () => {
    render(<RejectTripModal trip={trip} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject trip' }));
    expect(await screen.findByText('Enter a reason')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason', async () => {
    render(<RejectTripModal trip={trip} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  No KZ visa ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject trip' }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toEqual({ tripId: 7, reason: 'No KZ visa' });
  });
});
