import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import '@/i18n';
import type { IShipmentSheetItem } from '@/types';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import { ShipmentTruckMapModal } from './ShipmentTruckMapModal';
import type { ITruckPositionResult } from '@/hooks/useShipmentTruckPosition';

// react-leaflet needs real DOM measurements happy-dom doesn't implement — same
// mocking strategy as FleetMap.test.tsx, so this stays a test of the modal's
// own branch logic (which of the three "no map" messages shows), not of Leaflet.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  // Surface the icon url so the "same artwork as the Fleet Map" promise is
  // assertable without a real Leaflet canvas — same shape FleetMap.test uses.
  Marker: ({ children, icon }: { children?: React.ReactNode; icon?: { options: { iconUrl: string } } }) => (
    <div data-testid="truck-pin" data-icon={icon?.options.iconUrl}>{children}</div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn() }),
}));

let result: { data?: ITruckPositionResult; isLoading: boolean; isError: boolean };
vi.mock('@/hooks/useShipmentTruckPosition', () => ({
  useShipmentTruckPosition: () => result,
}));

const base = MOCK_SHEET_DATA[0] as IShipmentSheetItem;

function renderModal(shipment: Partial<IShipmentSheetItem>) {
  return render(
    <ShipmentTruckMapModal shipment={{ ...base, ...shipment } as IShipmentSheetItem} onClose={vi.fn()} />,
  );
}

const POSITION = {
  lat: 41.2, lon: 59.9, speed: 62, course: 180,
  address: 'Türkmenabat', fix_time: '2026-09-07T08:00:00Z',
  is_online: true, is_stale: false,
};
const DEVICE = { traccar_id: 7, plate: '48 AT 580', fleet_no: 'F12' };

beforeEach(() => {
  result = { data: undefined, isLoading: false, isError: false };
});

describe('ShipmentTruckMapModal — the three "no map" states', () => {
  it('asks the operator to set the truck when neither plate nor truck head is set', () => {
    result = { data: { resolved_by: 'none', device: null, position: null }, isLoading: false, isError: false };
    renderModal({ truck_plate: null, truck_head_id: null });
    expect(screen.getByText(/set the truck/i)).toBeTruthy();
  });

  it('says the truck has no GPS device when a truck IS set but nothing resolves', () => {
    result = { data: { resolved_by: 'none', device: null, position: null }, isLoading: false, isError: false };
    renderModal({ truck_plate: '48 AT 580', truck_head_id: null });
    // NOT the "set the truck" prompt — the operator already did that.
    expect(screen.queryByText(/set the truck/i)).toBeNull();
    expect(screen.getByText(/no gps device/i)).toBeTruthy();
  });

  it('says there is no signal yet when a device resolves but has never reported', () => {
    result = { data: { resolved_by: 'auto', device: DEVICE, position: null }, isLoading: false, isError: false };
    renderModal({ truck_plate: '48 AT 580' });
    expect(screen.getByText(/no position yet/i)).toBeTruthy();
    expect(screen.queryByTestId('map-container')).toBeNull();
  });
});

describe('ShipmentTruckMapModal — resolved position', () => {
  it('renders the map with the truck pin and the plate', () => {
    result = { data: { resolved_by: 'manual', device: DEVICE, position: POSITION }, isLoading: false, isError: false };
    renderModal({ truck_plate: '48 AT 580' });
    expect(screen.getByTestId('map-container')).toBeTruthy();
    expect(screen.getByTestId('truck-pin')).toBeTruthy();
    expect(screen.getAllByText(/48 AT 580/).length).toBeGreaterThan(0);
  });

  it('shows a hand-linked device even when the Sheet row names no truck at all', () => {
    // A manual ShipmentDeviceLink is resolver step 1 and ignores truck_plate /
    // truck_head_id — that override exists precisely for stale or mistyped
    // plates. The "set the truck" prompt must never hide a live position.
    result = { data: { resolved_by: 'manual', device: DEVICE, position: POSITION }, isLoading: false, isError: false };
    renderModal({ truck_plate: null, truck_head_id: null });
    expect(screen.getByTestId('map-container')).toBeTruthy();
    expect(screen.queryByText(/set the truck/i)).toBeNull();
  });

  it('draws the truck with the Fleet Map artwork, on the same legend', () => {
    // Rolling (online, speed > 0) is blue on the Fleet Map; the modal must not
    // invent its own pin or its own colour rules for the same truck.
    result = { data: { resolved_by: 'auto', device: DEVICE, position: POSITION }, isLoading: false, isError: false };
    renderModal({ truck_plate: '48 AT 580' });
    expect(screen.getByTestId('truck-pin').getAttribute('data-icon')).toBe('/truck-map-icons/pin-moving.png');
  });

  it('uses the stopped pin for a stale fix', () => {
    result = {
      data: { resolved_by: 'auto', device: DEVICE, position: { ...POSITION, is_stale: true } },
      isLoading: false,
      isError: false,
    };
    renderModal({ truck_plate: '48 AT 580' });
    expect(screen.getByTestId('truck-pin').getAttribute('data-icon')).toBe('/truck-map-icons/pin-stopped.png');
  });

  it('shows the address and speed line', () => {
    result = { data: { resolved_by: 'auto', device: DEVICE, position: POSITION }, isLoading: false, isError: false };
    renderModal({ truck_plate: '48 AT 580' });
    // The address renders twice — in the pin popup and in the summary line —
    // so this asserts presence, not uniqueness.
    expect(screen.getAllByText(/Türkmenabat/).length).toBeGreaterThan(0);
    // i18n splits the summary across text nodes; read the whole modal body.
    expect(document.body.textContent).toContain('62');
    expect(document.body.textContent).toContain('km/h');
  });

  it('surfaces a load error instead of an empty map', () => {
    result = { data: undefined, isLoading: false, isError: true };
    renderModal({ truck_plate: '48 AT 580' });
    expect(screen.queryByTestId('map-container')).toBeNull();
    expect(screen.getByText(/could not load/i)).toBeTruthy();
  });
});
