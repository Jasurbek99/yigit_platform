import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { LinkedTripsTab } from './LinkedTripsTab';
import * as trips from '@/hooks/useExternalTrips';

vi.mock('@/hooks/useExternalTrips');

const mutation = { mutate: vi.fn(), isPending: false } as any;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function renderTab(canEdit: boolean, conflictNote: string | null) {
  vi.mocked(trips.useExternalTrips).mockReturnValue({ data: [{
    id: 5, shipment_code: 'KZ-SHIP', tractor_plate: '2563AHF', trailer_plate: '2251TAH',
    driver_full_name: 'Amandurdyyew Atajan', status: 'PLANNED', conflict_note: conflictNote,
    destination_country_code: 'KZ',
  }], isLoading: false } as any);
  vi.mocked(trips.useCandidateShipments).mockReturnValue({ data: [] } as any);
  vi.mocked(trips.useUnassignTrip).mockReturnValue(mutation);
  vi.mocked(trips.useMoveTrip).mockReturnValue(mutation);
  vi.mocked(trips.useAcceptTripChange).mockReturnValue(mutation);
  render(<LinkedTripsTab canEdit={canEdit} />);
}

describe('LinkedTripsTab', () => {
  it('shows the conflict and offers Accept only when there is one', () => {
    renderTab(true, 'Planning changed the truck: A → B');
    expect(screen.getByText('Planning changed the truck: A → B')).toBeInTheDocument();
    expect(screen.getByText('Accept change')).toBeInTheDocument();
    expect(screen.getByText('Unlink')).toBeInTheDocument();
  });

  it('hides every action from a read-only viewer', () => {
    renderTab(false, 'x');
    expect(screen.getByText('KZ-SHIP')).toBeInTheDocument();
    expect(screen.queryByText('Unlink')).toBeNull();
    expect(screen.queryByText('Accept change')).toBeNull();
  });
});
