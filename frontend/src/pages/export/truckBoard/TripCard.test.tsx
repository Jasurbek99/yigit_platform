import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { TripCard } from './TripCard';
import type { IExternalTrip } from '@/types/externalTrip';

beforeAll(async () => { await i18n.changeLanguage('en'); });

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
});
