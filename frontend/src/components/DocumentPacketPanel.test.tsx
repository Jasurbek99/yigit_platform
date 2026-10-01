import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { DocumentPacketPanel } from './DocumentPacketPanel';
import type { IDocumentPacket } from '@/types';

vi.mock('@/components/CmrDocumentsButton', () => ({ CmrDocumentsButton: () => null }));
vi.mock('@/components/InvoiceDocumentsButton', () => ({ InvoiceDocumentsButton: () => null }));
vi.mock('@/components/PacketZipButton', () => ({ PacketZipButton: () => null }));
vi.mock('@/components/TirCarnetButton', () => ({ TirCarnetButton: () => null }));
vi.mock('@/components/sheet/ShipmentFirmContractsPanel', () => ({ ShipmentFirmContractsPanel: () => null }));
vi.mock('@/components/sheet/ShipmentPackingPanel', () => ({ ShipmentPackingPanel: () => null }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const packet = (over: Partial<IDocumentPacket> = {}): IDocumentPacket => ({
  id: 1, shipment_code: '0101701/25', export_code: null, date: '2026-09-10',
  status_code: 'draft', status_display: 'Preparation', country_name: null, city_name: null,
  buyer_name: null, packing_complete: true, missing_packing: [],
  missing_setup: ['driver_name', 'truck_plate'], is_gapy_satys: false, is_ready: false, firms: [],
  ...over,
});

describe('DocumentPacketPanel setup notice', () => {
  it('on the shipment page: «complete on this page» with a jump to the trip block', () => {
    const onJumpTo = vi.fn();
    render(<DocumentPacketPanel packet={packet()} onJumpTo={onJumpTo} />);
    expect(screen.getByText(i18n.t('documents_page.complete_here'))).toBeInTheDocument();
    expect(screen.queryByText(/Sheet/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('documents_page.field.truck') }));
    expect(onJumpTo).toHaveBeenCalledWith('detail-field-trip_id');
  });

  it('on the Documents page a regular truck is sent to a Planning trip', () => {
    render(<DocumentPacketPanel packet={packet()} />);
    expect(screen.getByText(i18n.t('documents_page.choose_trip'))).toBeInTheDocument();
  });
});
