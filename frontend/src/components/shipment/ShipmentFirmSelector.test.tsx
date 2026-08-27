import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ShipmentFirmSelector, firmCommitPayload } from './ShipmentFirmSelector';
import type { IShipmentDetail } from '@/types';

const mutate = vi.fn();
vi.mock('@/hooks/useSetFirmSplits', () => ({ useSetFirmSplits: () => ({ mutate, isPending: false }) }));
vi.mock('@/hooks/useAdmin', () => ({
  useAdminFirms: () => ({
    data: [
      { id: 1, code: 'YGT', name_tk: 'Ygt', name_en: 'YGT', is_active: true },
      { id: 2, code: 'HJ', name_tk: 'Hj', name_en: 'HJ', is_active: true },
      { id: 3, code: 'OLD', name_tk: 'Old', name_en: 'Old', is_active: false },
    ],
  }),
}));
vi.mock('@/hooks/useQuotaDashboard', () => ({
  useQuotaFirmBalances: () => ({ data: { '1': { remaining_kg: 5000 }, '2': { remaining_kg: 0 } } }),
}));

function makeShipment(firmIds: number[]): IShipmentDetail {
  return {
    id: 42,
    export_firms_display: firmIds.length ? firmIds.map((i) => (i === 1 ? 'YGT' : 'HJ')).join(', ') : null,
    firm_splits: firmIds.map((id) => ({
      export_firm_id: id, export_firm_name: null, weight_kg: 0, amount_usd: null, invoice_number: null,
    })),
  } as unknown as IShipmentDetail;
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('firmCommitPayload', () => {
  it('returns null when the set is unchanged (order-insensitive)', () => {
    expect(firmCommitPayload([1, 2], [2, 1])).toBeNull();
  });
  it('returns the next set when a firm is added', () => {
    expect(firmCommitPayload([1], [1, 2])).toEqual([1, 2]);
  });
  it('returns the next set when a firm is removed', () => {
    expect(firmCommitPayload([1, 2], [1])).toEqual([1]);
  });
});

describe('ShipmentFirmSelector', () => {
  beforeEach(() => { mutate.mockClear(); i18n.changeLanguage('en'); });

  it('read-only: shows the firms display text, no combobox', () => {
    wrap(<ShipmentFirmSelector shipment={makeShipment([1])} readOnly />);
    expect(screen.getByText('YGT')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('editable: renders a combobox with the current firm selected', () => {
    wrap(<ShipmentFirmSelector shipment={makeShipment([1])} readOnly={false} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText(/YGT — YGT/)).toBeInTheDocument();
  });
});
