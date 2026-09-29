import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShipmentTransportBody } from './ShipmentTransportBody';
import type { IShipmentDetail } from '@/types';

// The selectors write truck_head_id / driver_id — refused by the backend with
// 400 trip_locked once a Planning trip is linked, so they must render read-only.
vi.mock('@/components/shipment/ShipmentTruckSelector', () => ({
  ShipmentTruckSelector: ({ readOnly }: { readOnly: boolean }) => <div>truck-selector readOnly={String(readOnly)}</div>,
}));
vi.mock('@/components/shipment/ShipmentDriverSelector', () => ({
  ShipmentDriverSelector: ({ readOnly }: { readOnly: boolean }) => <div>driver-selector readOnly={String(readOnly)}</div>,
}));
vi.mock('@/components/shipment/ShipmentTripBanner', () => ({ ShipmentTripBanner: () => null }));
vi.mock('@/components/shipment/ShipmentFieldGroup', () => ({
  ShipmentFieldGroup: ({ lockedKeys }: { lockedKeys?: readonly string[] }) => (
    <div>group-locked={(lockedKeys ?? []).join(',')}</div>
  ),
}));

function renderBody(tripId: number | null) {
  const shipment = { id: 1, is_gapy_satys: false, trip_id: tripId } as unknown as IShipmentDetail;
  render(<ShipmentTransportBody shipment={shipment} missingKeys={new Set()} readOnly={false} />);
}

describe('ShipmentTransportBody with a Planning trip', () => {
  it('locks the truck and driver selectors while a trip is linked', () => {
    renderBody(5);
    expect(screen.getByText('truck-selector readOnly=true')).toBeInTheDocument();
    expect(screen.getByText('driver-selector readOnly=true')).toBeInTheDocument();
    expect(screen.getByText(/group-locked=.*driver_phone/)).toBeInTheDocument();
  });

  it('leaves them editable without a trip', () => {
    renderBody(null);
    expect(screen.getByText('truck-selector readOnly=false')).toBeInTheDocument();
  });
});
