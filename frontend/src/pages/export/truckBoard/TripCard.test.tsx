import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { TripCard } from './TripCard';
import type { IExternalTrip } from '@/types/externalTrip';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: unknown }) => <div data-testid="trip-mini-map">{children as never}</div>,
  TileLayer: () => null, Marker: () => null, useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn() }),
}));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const full = {
  id: 2, tractor_plate: '2563AHF', trailer_plate: '2251TAH', driver_full_name: 'Amandurdyyew Atajan',
  planned_departure: '2026-10-11', tractor_source: 'GARAGE', destination_country_code: 'RU',
  visa_country_codes: ['RU'], has_unrecognised_visa: false, trip_number: 'X-TEST-0001', status: 'PLANNED',
  tractor_brand: 'DAF', tractor_model: 'XF480', tractor_company: 'YIGIT HJ',
  trailer_brand: 'SCHMITZ', trailer_model: 'S.KO', trailer_company: null,
  driver_phone: '99361202698', driver_passport_number: 'A2510574', driver_passport_expiry: '2029-04-08',
  visas: [{ country: 'Russiýa', expiry_date: '2026-10-28' }],
  position: { lat: 37.9, lon: 58.4, address: 'Ashgabat', fix_time: null, geofence_name: null },
} as unknown as IExternalTrip;

describe('TripCard', () => {
  it('shows how old the GPS position is', () => {
    vi.useFakeTimers({ now: new Date('2026-09-30T10:10:00Z') });
    const trip = {
      id: 1, tractor_plate: 'A', trailer_plate: 'B', driver_full_name: 'D', planned_departure: '2026-10-01',
      tractor_source: 'GARAGE', destination_country_code: 'KZ', visa_country_codes: ['KZ'], has_unrecognised_visa: false,
      position: { lat: 1, lon: 2, address: 'Ashgabat', fix_time: '2026-09-30T10:05:00Z', geofence_name: null },
    } as unknown as IExternalTrip;
    render(<TripCard trip={trip} selected={false} countryCode="KZ" onSelect={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Ashgabat · 5 min ago/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('expands in place with the details and a mini map', () => {
    render(<TripCard trip={full} selected={false} countryCode="RU" onSelect={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByText('99361202698')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getByText('99361202698')).toBeInTheDocument();
    expect(screen.getByText(/A2510574 · valid until 2029-04-08/)).toBeInTheDocument();
    expect(screen.getByText(/DAF XF480 · YIGIT HJ/)).toBeInTheDocument();
    expect(screen.getByText(/Russiýa — 2026-10-28/)).toBeInTheDocument();
    expect(screen.getByText(/X-TEST-0001 · Planned/)).toBeInTheDocument();
    expect(screen.getByTestId('trip-mini-map')).toBeInTheDocument();
  });

  it('has no map when the truck has no GPS', () => {
    render(<TripCard trip={{ ...full, position: null }} selected={false} countryCode="RU" onSelect={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.queryByTestId('trip-mini-map')).toBeNull();
  });

  it('marks a rejected trip with its reason', () => {
    render(<TripCard trip={{ ...full, rejected_at: '2026-10-07T10:00:00Z', rejection_reason: 'No KZ visa' }}
      selected={false} countryCode="RU" onSelect={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Rejected: No KZ visa')).toBeInTheDocument();
  });
});
