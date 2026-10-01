import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from 'antd';
import i18n from '@/i18n';
import { ShipmentTripBanner } from './ShipmentTripBanner';
import * as trips from '@/hooks/useExternalTrips';

vi.mock('@/hooks/useExternalTrips');
beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderBanner(trip: object | null, canUnlink = false) {
  vi.mocked(trips.useShipmentTrip).mockReturnValue({ data: trip } as any);
  vi.mocked(trips.useAcceptTripChange).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  const unassign = { mutate: vi.fn(), isPending: false };
  vi.mocked(trips.useUnassignTrip).mockReturnValue(unassign as any);
  const view = render(<ShipmentTripBanner shipmentId={7} canEdit canUnlink={canUnlink} />);
  return { ...view, unassign };
}

describe('ShipmentTripBanner', () => {
  it('words the conflict from its structured fields, in the UI language', () => {
    renderBanner({
      id: 3, trip_number: '04AP034/26', status: 'PLANNED', conflict_kind: 'changed',
      conflict_from: 'A/1, Old', conflict_to: 'B/2, New', conflict_note: 'english text', last_push_error: null,
    });
    expect(screen.getByText('Planning changed the truck: A/1, Old → B/2, New')).toBeInTheDocument();
    expect(screen.queryByText('english text')).toBeNull();
    expect(screen.getByText(/04AP034\/26/)).toBeInTheDocument();
  });

  it('translates the trip status and a refused push', () => {
    renderBanner({
      id: 3, trip_number: null, status: 'DOCUMENTS_READY', conflict_kind: null,
      last_push_error: 'export-code: DUPLICATE_EXPORT_CODE',
    });
    expect(screen.getByText('Documents ready')).toBeInTheDocument();
    expect(screen.getByText('Planning refused the export code: another trip already has it')).toBeInTheDocument();
  });

  it('renders nothing without a trip', () => {
    const { container } = renderBanner(null);
    expect(container).toBeEmptyDOMElement();
  });
  it('unlinks after confirmation when allowed', () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((cfg) => {
      cfg.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });
    const { unassign } = renderBanner(
      { id: 3, trip_number: 'T1', status: 'PLANNED', conflict_kind: null, last_push_error: null }, true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(unassign.mutate).toHaveBeenCalledWith({ tripId: 3 }, expect.anything());
    confirm.mockRestore();
  });

  it('hides unlink without the right', () => {
    renderBanner({ id: 3, trip_number: 'T1', status: 'PLANNED', conflict_kind: null, last_push_error: null });
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });
});
