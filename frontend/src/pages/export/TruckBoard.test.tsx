import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import TruckBoard from './TruckBoard';
import * as trips from '@/hooks/useExternalTrips';
import { toast } from 'sonner';

vi.mock('@/hooks/useExternalTrips');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { is_superuser: true } }) }));
vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => false }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>, TileLayer: () => null, Marker: () => null,
  Popup: () => null, useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn() }),
}));

const base = { visas: [], visa_country_codes: [], position: null, tractor_source: 'GARAGE', trailer_plate: 'T', driver_full_name: 'D', planned_departure: '2026-10-01' };

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderBoard(assignMutate = vi.fn()) {
  vi.mocked(trips.useCandidateShipments).mockReturnValue({ data: [
    { id: 1, shipment_code: 'KZ-SHIP', customer: 3, date: '2026-10-01', country_code: 'KZ', country_name: 'GAZAGYSTAN', customer_name: 'C', blocks: ['A'] },
    { id: 2, shipment_code: 'RU-SHIP', customer: 3, date: '2026-10-01', country_code: 'RU', country_name: 'RUSSIYA', customer_name: 'C', blocks: ['B'] },
  ], isLoading: false } as any);
  vi.mocked(trips.useExternalTrips).mockReturnValue({ data: [
    { ...base, id: 10, tractor_plate: 'KZ-TRUCK', destination_country_code: 'KZ' },
    { ...base, id: 11, tractor_plate: 'RU-TRUCK', destination_country_code: 'RU' },
    { ...base, id: 12, tractor_plate: 'NO-COUNTRY', destination_country_code: null },
  ], isLoading: false } as any);
  vi.mocked(trips.useTripSyncState).mockReturnValue({ data: { last_success_at: null, last_error: '', is_mock: true } } as any);
  vi.mocked(trips.useAssignTrip).mockReturnValue({ mutate: assignMutate, isPending: false } as any);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TruckBoard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TruckBoard', () => {
  it('selecting a KZ shipment hides RU trucks and greys unknown-country trucks', () => {
    renderBoard();
    fireEvent.click(screen.getByText('KZ-SHIP'));
    expect(screen.queryByText(/RU-TRUCK/)).toBeNull();
    expect(screen.getByText(/KZ-TRUCK/)).toBeInTheDocument();
    expect(screen.getByText(/NO-COUNTRY/)).toBeInTheDocument();
    expect(screen.getByText('Trip country not set')).toBeInTheDocument();
  });

  it('selecting a RU truck hides KZ shipments', () => {
    renderBoard();
    fireEvent.click(screen.getByText(/RU-TRUCK/));
    expect(screen.queryByText('KZ-SHIP')).toBeNull();
    expect(screen.getByText('RU-SHIP')).toBeInTheDocument();
  });

  it('shows the demo badge in mock mode', () => {
    renderBoard();
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('shows the translated API error key from the {error} body', () => {
    const mutate = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) => opts.onError(
      Object.assign(new Error('409'), { isAxiosError: true, response: { data: { error: 'trip_taken' } } }),
    ));
    renderBoard(mutate);
    fireEvent.click(screen.getByText('KZ-SHIP'));
    fireEvent.click(screen.getByText(/KZ-TRUCK/));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(toast.error).toHaveBeenCalledWith('This truck is already assigned');
  });
});
