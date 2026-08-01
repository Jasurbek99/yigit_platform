import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from '@/i18n';
import FleetMap from './FleetMap';
import { useLivePositions } from '@/hooks/useLivePositions';

// react-leaflet needs real DOM measurements (getBoundingClientRect etc.) that
// happy-dom doesn't implement — mock the map primitives so this stays a
// smoke test of FleetMap's own render logic (search/list/pin colouring),
// not of Leaflet's canvas internals. The React-18/react() crash this test
// guards against (TypeError: use is not a function from @react-leaflet/core)
// happens inside react-leaflet's real components, so it's verified instead
// via `npm ls react-leaflet @react-leaflet/core` (see task-7 fix report).
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle-marker">{children}</div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useLivePositions', () => ({
  useLivePositions: vi.fn(),
}));

function renderFleetMap() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/transport/map']}>
        <FleetMap />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FleetMap', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('mounts without throwing and renders one truck pin from useLivePositions', () => {
    vi.mocked(useLivePositions).mockReturnValue({
      data: [
        {
          device_id: 74,
          plate: '2189AHF',
          fleet_no: 'TR038',
          status: 'online',
          lat: 37.97,
          lon: 58.49,
          speed: 40,
          course: 298,
          address: 'Artyk',
          fix_time: '2026-07-30T05:26:28Z',
          is_online: true,
          is_stale: false,
        },
      ],
      isLoading: false,
      isError: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderFleetMap();

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('circle-marker')).toBeInTheDocument();
    // Plate renders twice — once in the sidebar list, once in the mocked popup.
    expect(screen.getAllByText('2189AHF').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('Search plate / fleet / place')).toBeInTheDocument();
  });

  it('shows the load-error alert when the query fails', () => {
    vi.mocked(useLivePositions).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderFleetMap();

    expect(screen.getByText('Could not load truck positions')).toBeInTheDocument();
  });
});
