import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
// Hoisted so the vi.mock factory (which runs before the module body) can close
// over the same spy the assertions read.
const leaflet = vi.hoisted(() => ({ flyTo: vi.fn() }));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  // The icon url and width are surfaced as attributes so the state legend and
  // the selection highlight are assertable without a real Leaflet canvas.
  Marker: ({
    children,
    icon,
    eventHandlers,
  }: {
    children?: React.ReactNode;
    icon?: { options: { iconUrl: string; iconSize: [number, number] } };
    eventHandlers?: { click?: () => void };
  }) => (
    <div
      data-testid="truck-pin"
      data-icon={icon?.options.iconUrl}
      data-width={icon?.options.iconSize[0]}
      onClick={eventHandlers?.click}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ flyTo: leaflet.flyTo, getZoom: () => 5 }),
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

const basePosition = {
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
  updated_at: '2026-07-30T05:30:00Z',
  is_online: true,
  is_stale: false,
};

describe('FleetMap', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    leaflet.flyTo.mockClear();
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
          updated_at: '2026-07-30T05:30:00Z',
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
    expect(screen.getByTestId('truck-pin')).toBeInTheDocument();
    // Plate renders twice — once in the sidebar list, once in the mocked popup.
    expect(screen.getAllByText('2189AHF').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('Search plate / fleet / place')).toBeInTheDocument();
  });

  it('stamps the sidebar with the newest updated_at, in Ashgabat time', () => {
    // Two devices, different write times: the header must show the NEWEST, and
    // in +05 — a browser on UTC would otherwise render 05:30 and read as a
    // 5-hour-old sync.
    vi.mocked(useLivePositions).mockReturnValue({
      data: [
        { ...basePosition, device_id: 1, updated_at: '2026-07-30T05:30:00Z' },
        { ...basePosition, device_id: 2, updated_at: '2026-07-30T06:15:00Z' },
      ],
      isLoading: false,
      isError: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderFleetMap();

    expect(screen.getByText('Last sync: 30.07.2026 11:15')).toBeInTheDocument();
  });

  it('falls back to the no-data label when no positions have been synced', () => {
    vi.mocked(useLivePositions).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderFleetMap();

    expect(screen.getByText('Last sync: no data yet')).toBeInTheDocument();
  });

  it('flies to the truck picked from the sidebar and thickens its pin', () => {
    vi.mocked(useLivePositions).mockReturnValue({
      data: [
        { ...basePosition, device_id: 1, plate: 'AAA111', lat: 37.1, lon: 58.1 },
        { ...basePosition, device_id: 2, plate: 'BBB222', lat: 39.9, lon: 59.9 },
      ],
      isLoading: false,
      isError: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderFleetMap();
    expect(leaflet.flyTo).not.toHaveBeenCalled();

    // Sidebar renders before the map, so the first match is the list row.
    fireEvent.click(screen.getAllByText('BBB222')[0]);

    // Zoom is max(current, SELECTED_ZOOM) — the mocked map sits at 5.
    expect(leaflet.flyTo).toHaveBeenCalledWith([39.9, 59.9], 12);
    const widths = screen.getAllByTestId('truck-pin').map((el) => el.getAttribute('data-width'));
    expect(widths).toEqual(['34', '48']);
  });

  it('clears the selection when the same row is clicked again', () => {
    vi.mocked(useLivePositions).mockReturnValue({
      data: [{ ...basePosition, device_id: 1, plate: 'AAA111' }],
      isLoading: false,
      isError: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderFleetMap();
    fireEvent.click(screen.getAllByText('AAA111')[0]);
    expect(screen.getByTestId('truck-pin')).toHaveAttribute('data-width', '48');

    fireEvent.click(screen.getAllByText('AAA111')[0]);
    expect(screen.getByTestId('truck-pin')).toHaveAttribute('data-width', '34');
  });

  it('picks the pin artwork from the truck state, not from is_online alone', () => {
    // Owner's legend (2026-09-03): blue = rolling, green = parked, red = lost.
    // An online truck at 0 km/h is parked, NOT moving — that split is the whole
    // reason the artwork replaced the old three-colour dot.
    vi.mocked(useLivePositions).mockReturnValue({
      data: [
        { ...basePosition, device_id: 1, plate: 'MOV111', speed: 40 },
        { ...basePosition, device_id: 2, plate: 'IDL222', speed: 0 },
        { ...basePosition, device_id: 3, plate: 'OFF333', is_online: false },
        { ...basePosition, device_id: 4, plate: 'STL444', is_stale: true },
      ],
      isLoading: false,
      isError: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderFleetMap();

    expect(screen.getAllByTestId('truck-pin').map((el) => el.getAttribute('data-icon'))).toEqual([
      '/truck-map-icons/pin-moving.png',
      '/truck-map-icons/pin-idle.png',
      '/truck-map-icons/pin-stopped.png',
      '/truck-map-icons/pin-stopped.png',
    ]);
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
