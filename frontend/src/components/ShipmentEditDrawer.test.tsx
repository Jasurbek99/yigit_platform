import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  // Regression: ShipmentTruckSelector (rendered by this drawer for
  // non-Gapy-Satys shipments) PATCHes immediately and its onSettled
  // invalidates the shipment detail query. While the drawer is still open,
  // that refetch delivers a NEW `shipment` object of the SAME id to this
  // component. Before the fix, the reset effect was keyed on the `shipment`
  // object reference, so that refetch wiped every other staged-but-unsaved
  // field and disabled Save — silent data loss for whatever the user was
  // mid-editing (e.g. driver_name) when they also touched the truck
  // selector. Fixed by keying the reset effect on `shipment.id` instead.
  it('keeps a staged edit to another field when the same shipment refetches with a new object reference', async () => {
    const qc = new QueryClient();
    const shipmentV1 = { ...MOCK_SHIPMENT_DETAIL, is_gapy_satys: false };

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ShipmentEditDrawer open onClose={() => {}} shipment={shipmentV1} groupKey="transport" />
      </QueryClientProvider>,
    );

    const driverInput = screen
      .getByText('Driver name')
      .closest('.ant-form-item')!
      .querySelector('input') as HTMLInputElement;
    await userEvent.clear(driverInput);
    await userEvent.type(driverInput, 'Amanov');

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    // Simulate the background refetch: same shipment id, new object
    // reference — exactly what useShipmentDetail hands the parent after
    // ShipmentTruckSelector's PATCH settles, while the drawer stays open.
    const shipmentV2 = { ...shipmentV1 };
    rerender(
      <QueryClientProvider client={qc}>
        <ShipmentEditDrawer open onClose={() => {}} shipment={shipmentV2} groupKey="transport" />
      </QueryClientProvider>,
    );

    expect(screen.getByDisplayValue('Amanov')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
