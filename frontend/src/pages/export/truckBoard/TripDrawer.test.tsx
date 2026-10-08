import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { TripDrawer } from './TripDrawer';
import type { IExternalTrip } from '@/types/externalTrip';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: unknown }) => <div data-testid="trip-mini-map">{children as never}</div>,
  TileLayer: () => null, Marker: () => null, useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const rejected = {
  id: 2, tractor_plate: '2563AHF', trailer_plate: '2251TAH', driver_full_name: 'Amandurdyyew Atajan',
  planned_departure: '2026-10-11', tractor_source: 'GARAGE', destination_country_code: 'KZ',
  trip_number: 'X-TEST-0001', status: 'PLANNED', shipment: null, visas: [], position: null,
  driver_phone: null, driver_passport_number: null, driver_passport_expiry: null,
  tractor_brand: null, tractor_model: null, tractor_company: null,
  trailer_brand: null, trailer_model: null, trailer_company: null,
  rejected_at: '2026-10-07T10:00:00Z', rejection_reason: 'No KZ visa', rejected_by_name: 'Aman',
  last_push_status: null, last_push_error: null,
} as unknown as IExternalTrip;

function renderDrawer(trip: IExternalTrip) {
  render(<TripDrawer trip={trip} canReject onReject={vi.fn()} onClose={vi.fn()} />);
}

describe('TripDrawer', () => {
  it('hides Reject on a trip already rejected', () => {
    renderDrawer(rejected);
    expect(screen.queryByRole('button', { name: 'Reject trip' })).toBeNull();
  });

  it('offers Reject again when Planning did not receive the rejection', () => {
    renderDrawer({ ...rejected, last_push_status: 'error', last_push_error: 'rejection: PLANNING_UNAVAILABLE' });
    expect(screen.getByRole('button', { name: 'Reject trip' })).toBeInTheDocument();
    expect(screen.getByText('Planning did not receive the rejection — reject the trip again')).toBeInTheDocument();
  });
});
