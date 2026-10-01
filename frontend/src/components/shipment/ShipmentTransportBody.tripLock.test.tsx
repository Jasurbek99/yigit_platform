import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { ShipmentTransportBody } from './ShipmentTransportBody';
import { canManageTrips } from '@/components/shipment/tripAccess';
import type { IShipmentDetail } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('@/components/shipment/tripAccess', () => ({ canManageTrips: vi.fn(() => true) }));
vi.mock('@/components/shipment/ShipmentTripBanner', () => ({
  ShipmentTripBanner: ({ canUnlink }: { canUnlink?: boolean }) => <div>banner canUnlink={String(!!canUnlink)}</div>,
}));
vi.mock('@/components/shipment/TripPickerModal', () => ({ TripPickerModal: () => <div>trip-picker</div> }));
vi.mock('@/components/shipment/DetailFieldRow', () => ({
  DetailFieldRow: ({ config, readOnly }: { config: { key: string }; readOnly?: boolean }) => (
    <div>row {config.key} readOnly={String(!!readOnly)}</div>
  ),
}));
vi.mock('@/components/shipment/ShipmentFieldGroup', () => ({
  ShipmentFieldGroup: ({ lockedKeys }: { lockedKeys?: readonly string[] }) => (
    <div>group-locked={(lockedKeys ?? []).join(',')}</div>
  ),
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderBody(over: Partial<IShipmentDetail> = {}, readOnly = false) {
  const shipment = {
    id: 1, is_gapy_satys: false, trip_id: null, driver_passport_expiry: null,
    status_code: 'draft', country_code: 'KZ', ...over,
  } as unknown as IShipmentDetail;
  return render(<ShipmentTransportBody shipment={shipment} missingKeys={new Set()} readOnly={readOnly} />);
}

const chooseLabel = () => i18n.t('shipment_detail.parts.choose_trip');

describe('ShipmentTransportBody — transport part', () => {
  it('offers «choose trip» on a regular draft without a trip and opens the picker', () => {
    renderBody();
    fireEvent.click(screen.getByRole('button', { name: chooseLabel() }));
    expect(screen.getByText('trip-picker')).toBeInTheDocument();
  });

  it('keeps truck and driver read-only on a regular shipment (no TIR selectors)', () => {
    renderBody();
    expect(screen.getByText('row truck_plate readOnly=true')).toBeInTheDocument();
    expect(screen.getByText('row driver_name readOnly=true')).toBeInTheDocument();
  });

  it('disables «choose trip» until the country is set', () => {
    renderBody({ country_code: null });
    expect(screen.getByRole('button', { name: chooseLabel() })).toBeDisabled();
  });

  it('no choose button after draft', () => {
    renderBody({ status_code: 'gumruk_girish' });
    expect(screen.queryByRole('button', { name: chooseLabel() })).toBeNull();
  });

  it('no trip actions without the truck-board grant', () => {
    vi.mocked(canManageTrips).mockReturnValueOnce(false);
    renderBody();
    expect(screen.queryByRole('button', { name: chooseLabel() })).toBeNull();
    expect(screen.getByText('banner canUnlink=false')).toBeInTheDocument();
  });

  it('no trip actions in read-only', () => {
    renderBody({}, true);
    expect(screen.queryByRole('button', { name: chooseLabel() })).toBeNull();
    expect(screen.getByText('banner canUnlink=false')).toBeInTheDocument();
  });

  it('with a trip: no choose button, unlink offered, trip fields and second rig locked', () => {
    const { container } = renderBody({ trip_id: 5 });
    expect(screen.queryByRole('button', { name: chooseLabel() })).toBeNull();
    expect(screen.getByText('banner canUnlink=true')).toBeInTheDocument();
    expect(screen.getByText(/group-locked=.*driver_phone/)).toBeInTheDocument();
    expect(screen.getByText('row truck_plate_2 readOnly=true')).toBeInTheDocument();
    expect(container.querySelector('#detail-field-trip_id')).not.toBeNull();
  });

  it('gapy: editable truck and driver, no trip block', () => {
    const { container } = renderBody({ is_gapy_satys: true });
    expect(screen.getByText('row truck_plate readOnly=false')).toBeInTheDocument();
    expect(container.querySelector('#detail-field-trip_id')).toBeNull();
  });
});
