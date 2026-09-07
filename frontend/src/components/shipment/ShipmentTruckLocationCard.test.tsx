import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@/i18n';
import { ShipmentTruckLocationCard } from './ShipmentTruckLocationCard';
import type { ITruckPositionResult } from '@/hooks/useShipmentTruckPosition';

// Shipment Detail's wrapper around the shared block. What is worth pinning here
// is the half the Sheet's modal deliberately does NOT have: the manual device
// picker, and who sees it. The block's map/empty-state logic is covered by
// components/sheet/ShipmentTruckMapModal.test.tsx.

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children, icon }: { children?: React.ReactNode; icon?: { options: { iconUrl: string } } }) => (
    <div data-testid="truck-pin" data-icon={icon?.options.iconUrl}>{children}</div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn() }),
}));

let result: { data?: ITruckPositionResult; isLoading: boolean; isError: boolean };
const setMutate = vi.fn();
const clearMutate = vi.fn();
vi.mock('@/hooks/useShipmentTruckPosition', () => ({
  useShipmentTruckPosition: () => result,
  useSetShipmentDevice: () => ({ set: { mutate: setMutate }, clear: { mutate: clearMutate } }),
}));
const devicesHook = vi.fn((_opts?: { enabled?: boolean }) => ({
  data: [{ traccar_id: 7, plate: '48 AT 580', fleet_no: 'F12', name: 'TR038' }],
  isLoading: false,
}));
vi.mock('@/hooks/useTransportDevices', () => ({
  useTransportDevices: (opts?: { enabled?: boolean }) => devicesHook(opts),
}));

const POSITION = {
  lat: 41.2, lon: 59.9, speed: 0, course: 0,
  address: 'Türkmenabat', fix_time: '2026-09-07T08:00:00Z',
  is_online: true, is_stale: false,
};
const DEVICE = { traccar_id: 7, plate: '48 AT 580', fleet_no: 'F12' };

function renderCard(canEdit: boolean, hasTruck = true) {
  return render(
    <ShipmentTruckLocationCard shipmentId={1} hasTruck={hasTruck} canEdit={canEdit} />,
  );
}

beforeEach(() => {
  devicesHook.mockClear();
  result = { data: undefined, isLoading: false, isError: false };
});

describe('ShipmentTruckLocationCard', () => {
  it('draws the same Fleet Map pin the Sheet modal uses', () => {
    // Parked (online, speed 0) is green in the shared legend.
    result = { data: { resolved_by: 'auto', device: DEVICE, position: POSITION }, isLoading: false, isError: false };
    renderCard(false);
    expect(screen.getByTestId('truck-pin').getAttribute('data-icon')).toBe('/truck-map-icons/pin-idle.png');
  });

  it('offers an editor the link-device button when nothing resolves', () => {
    result = { data: { resolved_by: 'none', device: null, position: null }, isLoading: false, isError: false };
    renderCard(true);
    expect(screen.getByText(/link a device/i)).toBeTruthy();
  });

  it('shows a non-editor the same state read-only, and skips the registry fetch', () => {
    result = { data: { resolved_by: 'none', device: null, position: null }, isLoading: false, isError: false };
    renderCard(false);
    expect(screen.queryByText(/link a device/i)).toBeNull();
    expect(devicesHook).toHaveBeenCalledWith({ enabled: false });
  });

  it('swaps the link button for the device picker once an editor starts linking', () => {
    // Two-state dance the old card had too: the button is the entry point, the
    // Select replaces it. Nothing else exercises the transition.
    result = { data: { resolved_by: 'none', device: null, position: null }, isLoading: false, isError: false };
    renderCard(true);
    fireEvent.click(screen.getByText(/link a device/i));
    expect(screen.getByText(/pick a device/i)).toBeTruthy();
    expect(screen.queryByText(/link a device/i)).toBeNull();
  });

  it('offers the picker straight away when a device resolved but has never reported', () => {
    // "No signal yet" is a plausible wrong-device symptom, so an editor should be
    // able to re-point it without first clicking through the link button.
    result = { data: { resolved_by: 'auto', device: DEVICE, position: null }, isLoading: false, isError: false };
    renderCard(true);
    expect(screen.getByText(/no position yet/i)).toBeTruthy();
    expect(screen.getByText(/pick a device/i)).toBeTruthy();
  });

  it('offers an editor "reset to auto" only on a manual override', () => {
    result = { data: { resolved_by: 'manual', device: DEVICE, position: POSITION }, isLoading: false, isError: false };
    renderCard(true);
    expect(screen.getByText(/reset to auto/i)).toBeTruthy();
  });

  it('does not offer "reset to auto" on an auto-resolved device', () => {
    result = { data: { resolved_by: 'auto', device: DEVICE, position: POSITION }, isLoading: false, isError: false };
    renderCard(true);
    expect(screen.queryByText(/reset to auto/i)).toBeNull();
  });

  it('tells an operator to set the truck when the shipment names none', () => {
    result = { data: { resolved_by: 'none', device: null, position: null }, isLoading: false, isError: false };
    renderCard(false, false);
    expect(screen.getByText(/set the truck/i)).toBeTruthy();
  });
});
