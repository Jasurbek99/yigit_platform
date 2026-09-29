import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { ShipmentTripBanner } from './ShipmentTripBanner';
import * as trips from '@/hooks/useExternalTrips';

vi.mock('@/hooks/useExternalTrips');
beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('ShipmentTripBanner', () => {
  it('shows the conflict note and trip number', () => {
    vi.mocked(trips.useShipmentTrip).mockReturnValue({ data: {
      id: 3, trip_number: '04AP034/26', status: 'PLANNED', conflict_note: 'Planning changed the truck: A → B',
    } } as any);
    vi.mocked(trips.useAcceptTripChange).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    render(<ShipmentTripBanner shipmentId={7} canEdit />);
    expect(screen.getByText(/Planning changed the truck: A → B/)).toBeInTheDocument();
    expect(screen.getByText(/04AP034\/26/)).toBeInTheDocument();
  });

  it('renders nothing without a trip', () => {
    vi.mocked(trips.useShipmentTrip).mockReturnValue({ data: null } as any);
    const { container } = render(<ShipmentTripBanner shipmentId={7} canEdit />);
    expect(container).toBeEmptyDOMElement();
  });
});
