import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ShipmentEditDrawer } from './ShipmentEditDrawer';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';

// Superuser bypasses field_permissions entirely (see canEditField), so every
// field in the `transport` group — including truck_plate — reaches the
// render loop regardless of what field_permissions.shipment contains.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { is_superuser: true } }),
}));

vi.mock('@/hooks/useShipmentPatch', () => ({
  useShipmentPatchMulti: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useFleet', () => ({
  useTruckHeads: () => ({ data: [{ id: 101, plate_number: '01ABC123', owner_type: 'company', status: 'idle', has_gps: true }] }),
  useTrailers: () => ({ data: [] }),
}));

// FieldEditor unconditionally calls every reference-data hook it might need
// regardless of which field is actually being rendered — stub them all so
// this drawer test doesn't make real network calls for the fields we're not
// asserting on.
vi.mock('@/hooks/useAdmin', () => ({
  useCountries: () => ({ data: [] }),
  useCities: () => ({ data: [] }),
  useCustomers: () => ({ data: [] }),
  useAdminImportFirms: () => ({ data: [] }),
  useTomatoVarieties: () => ({ data: [] }),
  useBorderPoints: () => ({ data: [] }),
  useShipmentOptions: () => ({ data: [] }),
}));

function wrap(shipment: typeof MOCK_SHIPMENT_DETAIL) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ShipmentEditDrawer open onClose={() => {}} shipment={shipment} groupKey="transport" />
    </QueryClientProvider>,
  );
}

describe('ShipmentEditDrawer — truck_plate injection', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders ShipmentTruckSelector instead of the plain text field for a non-Gapy-Satys shipment', () => {
    wrap({ ...MOCK_SHIPMENT_DETAIL, is_gapy_satys: false });

    expect(screen.getByLabelText('Truck (tractor)')).toBeInTheDocument();
    expect(screen.getByLabelText('Trailer')).toBeInTheDocument();
    // The plain-text truck_plate input (its value would be '01ABC123',
    // MOCK_SHIPMENT_DETAIL's truck_plate) must NOT also render.
    expect(screen.queryByDisplayValue('01ABC123')).not.toBeInTheDocument();
  });

  it('keeps the plain text field for a Gapy-Satys shipment (no fleet linkage)', () => {
    wrap({ ...MOCK_SHIPMENT_DETAIL, is_gapy_satys: true });

    expect(screen.queryByLabelText('Truck (tractor)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trailer')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('01ABC123')).toBeInTheDocument();
  });
});
