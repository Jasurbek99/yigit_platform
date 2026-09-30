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

function renderTab(canEdit: boolean, conflictKind: 'changed' | null, resetAt: string | null = null) {
  vi.mocked(trips.useExternalTrips).mockReturnValue({ data: [{
    id: 5, shipment_code: 'KZ-SHIP', tractor_plate: '2563AHF', trailer_plate: '2251TAH',
    driver_full_name: 'Amandurdyyew Atajan', status: 'PLANNED', conflict_kind: conflictKind,
    conflict_from: 'A', conflict_to: 'B',
    destination_country_code: 'KZ', shipment_documents_reset_at: resetAt,
  }], isLoading: false } as any);
  vi.mocked(trips.useCandidateShipments).mockReturnValue({ data: [] } as any);
  vi.mocked(trips.useUnassignTrip).mockReturnValue(mutation);
  vi.mocked(trips.useMoveTrip).mockReturnValue(mutation);
  vi.mocked(trips.useAcceptTripChange).mockReturnValue(mutation);
  render(<LinkedTripsTab canEdit={canEdit} />);
}

describe('LinkedTripsTab', () => {
  it('shows the conflict and offers Accept only when there is one', () => {
    renderTab(true, 'changed');
    expect(screen.getByText('Planning changed the truck: A → B')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText('Accept change')).toBeInTheDocument();
    expect(screen.getByText('Unlink')).toBeInTheDocument();
  });

  it('marks a trip whose shipment was rolled back for a truck change', () => {
    renderTab(false, null, '2026-09-30T08:00:00Z');
    expect(screen.getByText('Truck changed — redo the documents')).toBeInTheDocument();
  });

  it('hides every action from a read-only viewer', () => {
    renderTab(false, 'changed');
    expect(screen.getByText('KZ-SHIP')).toBeInTheDocument();
    expect(screen.queryByText('Unlink')).toBeNull();
    expect(screen.queryByText('Accept change')).toBeNull();
  });
});
