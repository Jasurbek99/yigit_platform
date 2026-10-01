import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import i18n from '@/i18n';
import { ShipmentDocumentsBody } from './ShipmentDocumentsBody';
import { ShipmentDestinationBody } from './ShipmentDestinationBody';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

vi.mock('@/services/api', () => ({ default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/sheet/ShipmentPackingPanel', () => ({ ShipmentPackingPanel: () => <div>packing-panel</div> }));
vi.mock('@/components/sheet/ShipmentFirmContractsPanel', () => ({
  ShipmentFirmContractsPanel: () => <div>contracts-panel</div>,
}));
vi.mock('@/components/shipment/ShipmentFirmSelector', () => ({ ShipmentFirmSelector: () => null }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}>{node}</QueryClientProvider></MemoryRouter>);
}

const withFirm = (over: Partial<IShipmentDetail> = {}): IShipmentDetail => ({
  ...MOCK_SHIPMENT_DETAIL,
  firm_splits: [{ export_firm_id: 1, export_firm_name: 'YGT', weight_kg: 1000, amount_usd: null, invoice_number: null }],
  ...over,
});

describe('Documents card — export part', () => {
  it('embeds the packing panel under the packing_template anchor', () => {
    const { container } = wrap(<ShipmentDocumentsBody shipment={withFirm()} missingKeys={new Set()} readOnly={false} />);
    const anchor = container.querySelector('#detail-field-packing_template') as HTMLElement;
    expect(within(anchor).getByText('packing-panel')).toBeInTheDocument();
  });

  it('read-only shows the template name instead of the panel', () => {
    wrap(<ShipmentDocumentsBody shipment={withFirm({ packing_template_name: '2 firms 20t' })} missingKeys={new Set()} readOnly />);
    expect(screen.queryByText('packing-panel')).toBeNull();
    expect(screen.getByText('2 firms 20t')).toBeInTheDocument();
  });

  it('shows the advance answer and the customs rows', () => {
    const { container } = wrap(
      <ShipmentDocumentsBody shipment={withFirm({ has_current_advance: true })} missingKeys={new Set()} readOnly={false} />,
    );
    const advance = container.querySelector('#detail-field-has_current_advance') as HTMLElement;
    expect(within(advance).getByText(i18n.t('common.yes'))).toBeInTheDocument();
    expect(container.querySelector('#detail-field-customs_exit_at')).not.toBeNull();
    expect(container.querySelector('#detail-field-document_note')).not.toBeNull();
  });
});

describe('Destination card — contracts', () => {
  it('shows the contracts panel once a firm is chosen', () => {
    wrap(<ShipmentDestinationBody shipment={withFirm()} missingKeys={new Set()} readOnly={false} />);
    expect(screen.getByText('contracts-panel')).toBeInTheDocument();
  });

  it('no panel without firms', () => {
    wrap(<ShipmentDestinationBody shipment={withFirm({ firm_splits: [] })} missingKeys={new Set()} readOnly={false} />);
    expect(screen.queryByText('contracts-panel')).toBeNull();
  });

  it('no panel in read-only', () => {
    wrap(<ShipmentDestinationBody shipment={withFirm()} missingKeys={new Set()} readOnly />);
    expect(screen.queryByText('contracts-panel')).toBeNull();
  });
});
