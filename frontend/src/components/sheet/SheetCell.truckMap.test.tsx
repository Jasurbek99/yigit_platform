import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import '@/i18n';
import type { IRowConfig, IShipmentSheetItem } from '@/types';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import { useSheetStore } from '@/stores/sheetStore';
import { SheetCell } from './SheetCell';

// The Vehicle Current Position / ETA cell (vehicle_live_status) carries a map
// pin that opens the truck's GPS position. Two things must hold and are easy to
// break: the pin must NOT mount the 30s-polling position query (900 cells ×
// one poll each would flood the API), and clicking it must not drop the cell
// into its text editor.

vi.mock('@/hooks/useAdmin', () => ({ useShipmentOptions: () => ({ data: [] }) }));
vi.mock('@/hooks/useSheetCellWrite', () => ({
  useSheetCellWrite: () => ({ clearCell: vi.fn() }),
  isClearableField: () => true,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), Link: () => null }));
vi.mock('@/hooks/useShipmentSheet', () => ({ useSetCellColor: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, role: 'export_manager', resource_permissions: {} } }),
}));
vi.mock('@/hooks/useShipmentFirmContracts', () => ({
  useShipmentContractStatus: () => ({ data: {} }),
  useShipmentFirmContracts: () => ({ data: undefined, isLoading: false }),
  useLinkFirmContract: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Spy on the position hook to prove the cell never subscribes to it.
const positionHook = vi.fn((_shipmentId: number) => ({ data: undefined, isLoading: true, isError: false }));
vi.mock('@/hooks/useShipmentTruckPosition', () => ({
  useShipmentTruckPosition: (id: number) => positionHook(id),
}));
vi.mock('react-leaflet', () => ({
  MapContainer: () => <div data-testid="map-container" />,
  TileLayer: () => null,
  Marker: () => null,
  Popup: () => null,
  useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn() }),
}));

const row = (field_key: string): IRowConfig => ({
  row_number: 15,
  field_key,
  default_who_key: 'sheet.who.haltac',
  label_key: `sheet.row.${field_key}`,
  input_type: 'text',
  style: 'transport',
});

function renderCell(shipment: Partial<IShipmentSheetItem>, fieldKey = 'vehicle_live_status') {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <SheetCell
        shipment={{ ...(MOCK_SHEET_DATA[0] as IShipmentSheetItem), ...shipment }}
        rowConfig={row(fieldKey)}
        isEditable
      />
    </QueryClientProvider>,
  );
  return container;
}

const pin = (c: HTMLElement) => c.querySelector('[data-testid="truck-map-pin"]');

beforeEach(() => {
  positionHook.mockClear();
  useSheetStore.setState({ activeCell: null, editingCell: null });
});

describe('vehicle_live_status map pin', () => {
  it('shows the pin on the Vehicle Current Position row', () => {
    expect(pin(renderCell({ is_gapy_satys: false }))).toBeTruthy();
  });

  it('hides the pin for Gapy Satyş shipments — they never leave for a destination', () => {
    expect(pin(renderCell({ is_gapy_satys: true }))).toBeNull();
  });

  it('leaves the Gapy cell text editable — only the pin goes away', () => {
    const c = renderCell({ is_gapy_satys: true, vehicle_live_status: 'Ammarda' });
    expect(c.textContent).toContain('Ammarda');
  });

  it('does not appear on other rows', () => {
    expect(pin(renderCell({ is_gapy_satys: false }, 'warehouse_note'))).toBeNull();
  });

  it('does not mount the 30s position poll until the map is opened', () => {
    renderCell({ is_gapy_satys: false });
    expect(positionHook).not.toHaveBeenCalled();
  });

  it('opens the map without dropping the cell into its text editor', async () => {
    const c = renderCell({ is_gapy_satys: false, vehicle_live_status: null });
    fireEvent.click(pin(c)!);
    expect(useSheetStore.getState().editingCell).toBeNull();
    // The modal is React.lazy'd (Leaflet stays out of the Sheet chunk), so the
    // position hook only mounts once that dynamic import resolves.
    await waitFor(() => expect(positionHook).toHaveBeenCalled());
  });
});
