import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { TaskDocumentButtons } from './TaskDocumentButtons';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import type { IDocumentPacket } from '@/types';

vi.mock('@/hooks/useDocumentPackets', () => ({ useShipmentDocumentPacket: vi.fn() }));
vi.mock('@/components/CmrDocumentsButton', () => ({
  CmrDocumentsButton: ({ disabled }: { disabled?: boolean }) => <div>CMR_BUTTON{disabled ? ' off' : ''}</div>,
}));
vi.mock('@/components/TirCarnetButton', () => ({ TirCarnetButton: () => <div>TIR_BUTTON</div> }));
vi.mock('@/components/InvoiceDocumentsButton', () => ({
  InvoiceDocumentsButton: ({ invoiceId, docType }: { invoiceId: number; docType?: string }) => (
    <div>LETTERS {invoiceId} {docType}</div>
  ),
}));

function packet(overrides: Partial<IDocumentPacket> = {}): IDocumentPacket {
  return {
    id: 7, shipment_code: 'SH-7', export_code: null, date: null, status_code: 'gumruk_girish',
    status_display: null, country_name: null, city_name: null, buyer_name: null,
    packing_complete: true, missing_packing: [], missing_setup: [], is_ready: true,
    firms: [
      { export_firm_id: 1, export_firm_name: 'YGT', sale_id: 11, invoice_number: 1 },
      { export_firm_id: 2, export_firm_name: 'HJ', sale_id: null, invoice_number: null },
    ],
    ...overrides,
  };
}

function withPacket(p: IDocumentPacket | null) {
  vi.mocked(useShipmentDocumentPacket).mockReturnValue(
    { data: p, isLoading: false } as unknown as ReturnType<typeof useShipmentDocumentPacket>,
  );
}

describe('print from the task card (2026-09-30)', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('«Print CMR» opens the CMR document', () => {
    withPacket(packet());
    render(<TaskDocumentButtons titleKey="tasks.print_cmr" shipmentId={7} />);
    expect(screen.getByText('CMR_BUTTON')).toBeInTheDocument();
    expect(screen.queryByText('TIR_BUTTON')).toBeNull();
  });

  it('the transport documents task shows both CMR and TIR', () => {
    withPacket(packet());
    render(<TaskDocumentButtons titleKey="tasks.prepare_transport_docs" shipmentId={7} />);
    expect(screen.getByText('CMR_BUTTON')).toBeInTheDocument();
    expect(screen.getByText('TIR_BUTTON')).toBeInTheDocument();
  });

  it('CT-1 / fito / customs letter open each firm’s documents', () => {
    withPacket(packet());
    render(<TaskDocumentButtons titleKey="tasks.print_ct1" shipmentId={7} />);
    expect(screen.getByText('LETTERS 11 ct1_ru')).toBeInTheDocument();
    expect(screen.getByText(/HJ/)).toBeInTheDocument();          // named, with no contract yet
  });

  it('fito and the customs letter open their own document', () => {
    withPacket(packet());
    const { unmount } = render(<TaskDocumentButtons titleKey="tasks.print_phyto" shipmentId={7} />);
    expect(screen.getByText('LETTERS 11 fito_ru')).toBeInTheDocument();
    unmount();
    render(<TaskDocumentButtons titleKey="tasks.print_customs_request" shipmentId={7} />);
    expect(screen.getByText('LETTERS 11 customs_tk')).toBeInTheDocument();
  });

  it('a truck that is not ready says what is missing and keeps the button off', () => {
    withPacket(packet({ is_ready: false, missing_setup: ['driver'] }));
    render(<TaskDocumentButtons titleKey="tasks.print_cmr" shipmentId={7} />);
    expect(screen.getByText('CMR_BUTTON off')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('other tasks show nothing', () => {
    withPacket(packet());
    const { container } = render(<TaskDocumentButtons titleKey="tasks.docs_to_stamp" shipmentId={7} />);
    expect(container).toBeEmptyDOMElement();
  });
});
