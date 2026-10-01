import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import { canDo } from '@/utils/permissions';
import { ShipmentDocumentsPrintCard } from './ShipmentDocumentsPrintCard';

vi.mock('@/hooks/useDocumentPackets', () => ({ useShipmentDocumentPacket: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('@/utils/permissions', () => ({ canDo: vi.fn() }));
vi.mock('@/components/DocumentPacketPanel', () => ({
  DocumentPacketPanel: ({ packet, onJumpTo }: { packet: { shipment_code: string }; onJumpTo?: unknown }) => (
    <div>packet {packet.shipment_code} jump={String(typeof onJumpTo === 'function')}</div>
  ),
}));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const refetch = vi.fn();

function setup(allowed: boolean, packet: object | null, firmCount = 1) {
  vi.mocked(canDo).mockReturnValue(allowed);
  refetch.mockClear();
  vi.mocked(useShipmentDocumentPacket).mockReturnValue(
    { data: packet, isLoading: false, isFetching: false, refetch } as unknown as ReturnType<typeof useShipmentDocumentPacket>,
  );
  return render(<ShipmentDocumentsPrintCard shipmentId={9} firmCount={firmCount} shipmentUpdatedAt="t1" />);
}

describe('ShipmentDocumentsPrintCard', () => {
  it('shows the truck packet (CMR, TIR, ZIP, per-firm invoices) in-page', () => {
    setup(true, { id: 9, shipment_code: '0101009/26' });
    expect(screen.getByText(i18n.t('shipment_detail.parts.documents_title'))).toBeInTheDocument();
    // The notice links to rows on this page instead of sending the user to the Sheet.
    expect(screen.getByText('packet 0101009/26 jump=true')).toBeInTheDocument();
  });

  it('explains the empty state before an export firm is chosen', () => {
    setup(true, null, 0);
    expect(screen.getByText(i18n.t('shipment_detail.parts.documents_no_firm'))).toBeInTheDocument();
  });

  it('does not claim «choose a firm» when firms exist but no packet came back', () => {
    const { container } = setup(true, null, 2);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden, and does not fetch, without the sale grant', () => {
    const { container } = setup(false, null);
    expect(container).toBeEmptyDOMElement();
    expect(useShipmentDocumentPacket).toHaveBeenLastCalledWith(null);
  });
  // Nothing on the page invalidates 'document-packets' when a firm is picked or a
  // field is saved, so the card must refresh itself or it shows a stale packet.
  it('refetches the packet when the first firm is picked', () => {
    const { rerender } = setup(true, null, 0);
    expect(refetch).not.toHaveBeenCalled();
    rerender(<ShipmentDocumentsPrintCard shipmentId={9} firmCount={1} shipmentUpdatedAt="t1" />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('refetches the packet after the shipment was saved', () => {
    const { rerender } = setup(true, { id: 9, shipment_code: '0101009/26' });
    rerender(<ShipmentDocumentsPrintCard shipmentId={9} firmCount={1} shipmentUpdatedAt="t2" />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
