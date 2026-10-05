import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import i18n from '@/i18n';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import { useShipmentFirmContracts } from '@/hooks/useShipmentFirmContracts';
import { useContract } from '@/hooks/useContracts';
import { canDo } from '@/utils/permissions';
import { downloadFile } from '@/utils/fileDownload';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IDocumentPacket, IShipmentDetail } from '@/types';
import { ShipmentDocumentsCard } from './ShipmentDocumentsCard';

vi.mock('@/hooks/useDocumentPackets', () => ({ useShipmentDocumentPacket: vi.fn() }));
vi.mock('@/hooks/useShipmentFirmContracts', () => ({ useShipmentFirmContracts: vi.fn() }));
vi.mock('@/hooks/useContracts', () => ({
  useContract: vi.fn(),
  contractAttachmentUrl: (c: number, a: number) => `/api/v1/contracts/contracts/${c}/attachments/${a}/download/`,
}));
vi.mock('@/hooks/useAdmin', () => ({
  useLoadingLocations: () => ({ data: [{ id: 1, name: 'Dusak' }, { id: 2, name: 'Kaka' }] }),
}));
vi.mock('@/hooks/useExternalTrips', () => ({
  useShipmentTrip: () => ({ data: { id: 77 } }),
  openTripDocument: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('@/utils/permissions', () => ({ canDo: vi.fn(), canSeePage: () => true, canWriteReferenceData: () => false }));
vi.mock('@/utils/fileDownload', () => ({ downloadFile: vi.fn() }));
vi.mock('@/components/TirCarnetButton', () => ({ TirCarnetButton: () => <span>tir-button</span> }));
vi.mock('@/components/ContractAgreementButton', () => ({
  ContractAgreementButton: ({ contractId }: { contractId: number }) => <span>agreement-{contractId}</span>,
}));
vi.mock('@/components/sheet/ShipmentFirmContractsPanel', () => ({ ShipmentFirmContractsPanel: () => null }));
vi.mock('@/components/sheet/ShipmentPackingPanel', () => ({ ShipmentPackingPanel: () => null }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const PACKET: IDocumentPacket = {
  id: 9, shipment_code: '0101009/26', export_code: null, is_gapy_satys: false, date: null,
  status_code: null, status_display: null, country_name: null, city_name: null, buyer_name: null,
  packing_complete: true, missing_packing: [], missing_setup: [], is_ready: true,
  firms: [
    { export_firm_id: 3, export_firm_name: 'AGRO', sale_id: 55, invoice_number: null, ct1_number: null, fito_number: null, customs_number: null },
    { export_firm_id: 4, export_firm_name: 'TERRA', sale_id: null, invoice_number: null, ct1_number: null, fito_number: null, customs_number: null },
  ],
};

const refetch = vi.fn();

function shipment(overrides: Partial<IShipmentDetail> = {}): IShipmentDetail {
  return {
    ...MOCK_SHIPMENT_DETAIL,
    id: 9, loading_location: 1, export_code: 'EX-1', trip_id: 5, is_gapy_satys: false,
    firm_splits: [MOCK_SHIPMENT_DETAIL.firm_splits[0] ?? ({} as IShipmentDetail['firm_splits'][0])],
    updated_at: 't1',
    quality: {
      azyk_maglumatnama: true, suriji_gozukdiriji: false, hil_sertifikaty: false, kalibrowka_analiz: false,
      certificates: [{
        id: 8, doc_type: 'azyk_maglumatnama', original_filename: 'scan.jpg', mime_type: 'image/jpeg',
        size_bytes: 10, uploaded_at: '2026-10-01T00:00:00Z', uploaded_by_name: 'x',
        download_url: '/api/v1/export/shipments/9/quality-certificates/8/download/',
      }],
    },
    ...overrides,
  };
}

function setup({ sale = true, contract = true, packet = PACKET as IDocumentPacket | null, ship = shipment() } = {}) {
  vi.mocked(canDo).mockImplementation((_u, resource) => (resource === 'sale' ? sale : contract));
  vi.mocked(useShipmentDocumentPacket).mockReturnValue(
    { data: packet, isLoading: false, isFetching: false, refetch } as unknown as ReturnType<typeof useShipmentDocumentPacket>,
  );
  vi.mocked(useShipmentFirmContracts).mockReturnValue({
    data: {
      shipment: 9, import_firm: 1, import_firm_name: 'Buyer', contract_template_supported: true,
      import_firm_director: null,
      rows: [{
        export_firm: 3, export_firm_code: 'AGR', export_firm_name: 'AGRO', weight_kg: null, amount_usd: null,
        money_warning: null, framework_options: [],
        linked: { contract_id: 12, contract_number: '12/26-AGR-EXP', contract_type: 'ONE_TIME' },
      }],
    },
  } as unknown as ReturnType<typeof useShipmentFirmContracts>);
  vi.mocked(useContract).mockReturnValue({
    data: { attachments: [{ id: 31, original_filename: 'signed.pdf', mime_type: 'application/pdf', size_bytes: 5, uploaded_by: 1, uploaded_by_name: 'x', uploaded_at: '' }] },
  } as unknown as ReturnType<typeof useContract>);
  return render(<ShipmentDocumentsCard shipment={ship} />);
}

/** The row whose label is exactly `label` — rows are the label's closest [data-doc-row]. */
function row(label: string): HTMLElement {
  return screen.getByText(label).closest('[data-doc-row]') as HTMLElement;
}

/** A download click settles its spinner after the (mocked) request resolves. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => { fireEvent.click(element); });
}

beforeEach(() => {
  vi.mocked(downloadFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(useContract).mockClear();
  refetch.mockClear();
});

describe('ShipmentDocumentsCard', () => {
  it('downloads a CMR in one click — no menu, no options modal', async () => {
    setup();
    await click(within(row('CMR')).getByRole('button', { name: 'RU Word' }));
    expect(downloadFile).toHaveBeenCalledWith('/contracts/shipments/9/cmr/?lang=ru&fmt=docx&place_loading=Dusak');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // RU and EN of one document share a row — half the rows of one-per-language.
  it('puts both languages of a document on one row', () => {
    setup();
    const cmr = within(row('CMR'));
    expect(cmr.getByRole('button', { name: 'RU Excel' })).toBeInTheDocument();
    expect(cmr.getByRole('button', { name: 'EN Excel' })).toBeInTheDocument();
    expect(screen.queryByText('CMR RU')).not.toBeInTheDocument();
  });

  it('lists every firm document as its own row and downloads it directly', async () => {
    setup();
    await click(within(row(i18n.t('documents.invoice'))).getByRole('button', { name: 'EN PDF' }));
    expect(downloadFile).toHaveBeenCalledWith('/contracts/sales/55/document/?type=invoice_en&fmt=pdf&place_loading=Dusak');
    // Letters take no loading point.
    await click(within(row(i18n.t('documents.ct1'))).getByRole('button', { name: 'Word' }));
    expect(downloadFile).toHaveBeenLastCalledWith('/contracts/sales/55/document/?type=ct1_ru&fmt=docx');
  });

  it('sends the top-bar options with every download', async () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('documents.highlight') }));
    fireEvent.change(screen.getByPlaceholderText(i18n.t('documents.tir_carnet_ph')), { target: { value: 'TX42' } });
    await click(within(row(i18n.t('shipment_detail.docs.packet_zip'))).getByRole('button', { name: 'EN PDF' }));
    expect(downloadFile).toHaveBeenCalledWith(
      '/contracts/shipments/9/packet.zip?lang=en&fmt=pdf&place_loading=Dusak&tir_carnet=TX42&highlight=0',
    );
  });

  it('sends the optional CMR box 17 text with the CMR', async () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(i18n.t('documents.successive_carrier_ph')), { target: { value: 'Trans LLC' } });
    await click(within(row('CMR')).getByRole('button', { name: 'EN Word' }));
    expect(downloadFile).toHaveBeenCalledWith(
      '/contracts/shipments/9/cmr/?lang=en&fmt=docx&place_loading=Dusak&successive_carrier=Trans+LLC',
    );
  });

  // The CMR's box 4 is fixed (Kaka), so only the invoice and the ZIP wait for a point.
  it('without a loading point, blocks the invoice / ZIP rows but not the CMR or letters', () => {
    setup({ ship: shipment({ loading_location: null }) });
    expect(within(row('CMR')).getByRole('button', { name: 'RU Word' })).toBeEnabled();
    expect(within(row(i18n.t('shipment_detail.docs.packet_zip'))).getByRole('button', { name: 'RU Word' })).toBeDisabled();
    expect(within(row(i18n.t('documents.invoice'))).getByRole('button', { name: 'RU Word' })).toBeDisabled();
    expect(within(row(i18n.t('documents.fito'))).getByRole('button', { name: 'Word' })).toBeEnabled();
    expect(screen.getAllByText(i18n.t('shipment_detail.docs.need_place_loading')).length).toBeGreaterThan(0);
  });

  it('keeps the TIR carnet and the contract behind their own option modals', () => {
    setup();
    expect(within(row(i18n.t('documents.tir'))).getByText('tir-button')).toBeInTheDocument();
    expect(screen.getByText('agreement-12')).toBeInTheDocument();
  });

  it('shows the contract attachments and quality scans with open + download', () => {
    setup();
    const attachment = within(row('signed.pdf'));
    expect(attachment.getByRole('link', { name: i18n.t('shipment_detail.docs.open') }))
      .toHaveAttribute('href', '/api/v1/contracts/contracts/12/attachments/31/download/');
    expect(attachment.getByRole('link', { name: i18n.t('documents.download') })).toHaveAttribute('download', 'signed.pdf');
    expect(within(row(`${i18n.t('quality.azyk_maglumatnama')} · scan.jpg`))
      .getByRole('link', { name: i18n.t('shipment_detail.docs.open') }))
      .toHaveAttribute('href', '/api/v1/export/shipments/9/quality-certificates/8/download/');
  });

  it('hides the contract and its attachments without the contract grant', () => {
    setup({ contract: false });
    expect(screen.queryByText('agreement-12')).not.toBeInTheDocument();
    expect(screen.queryByText('signed.pdf')).not.toBeInTheDocument();
    // The contract detail is a `contract` read — fetching it would 403.
    expect(useContract).not.toHaveBeenCalled();
  });

  it('offers «link contract» for a firm without a sale', () => {
    setup();
    expect(screen.getByRole('button', { name: i18n.t('documents_page.link_contract') })).toBeInTheDocument();
  });

  it('shows the QR label and the trip PDF under «Other»', async () => {
    setup();
    await click(within(row(i18n.t('shipment_detail.docs.qr_label'))).getByRole('button', { name: 'PDF' }));
    expect(downloadFile).toHaveBeenCalledWith('/export/shipments/9/label/');
    expect(row(i18n.t('truck_board.documents_pdf'))).toBeInTheDocument();
  });

  it('explains the empty state before an export firm is chosen', () => {
    setup({ packet: null, ship: shipment({ firm_splits: [] }) });
    expect(screen.getByText(i18n.t('shipment_detail.parts.documents_no_firm'))).toBeInTheDocument();
  });

  it('is hidden, and does not fetch, without the sale grant', () => {
    const { container } = setup({ sale: false });
    expect(container).toBeEmptyDOMElement();
    expect(useShipmentDocumentPacket).toHaveBeenLastCalledWith(null);
  });

  // Nothing on the page invalidates 'document-packets' when a firm is picked or a
  // field is saved, so the card must refresh itself or it shows a stale packet.
  it('refetches the packet after the shipment was saved', () => {
    const { rerender } = setup();
    rerender(<ShipmentDocumentsCard shipment={shipment({ updated_at: 't2' })} />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
