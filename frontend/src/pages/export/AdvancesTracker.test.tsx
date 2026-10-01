import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import AdvancesTracker from './AdvancesTracker';

const { mockUseAdvances, mockUser } = vi.hoisted(() => ({
  mockUseAdvances: vi.fn(),
  mockUser: { role: 'finansist', is_superuser: false },
}));
vi.mock('@/hooks/useAdvances', () => ({
  useAdvances: mockUseAdvances,
  useAdvanceDetail: () => ({ data: undefined, isLoading: false }),
  useReconcileAdvance: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAdvance: () => ({ mutate: vi.fn(), isPending: false }),
  useLinkShipmentToAdvance: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkShipmentFromAdvance: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCustomsExpenses', () => ({
  useCustomsLedger: () => ({ data: undefined, isLoading: false }),
  useCustomsExpenseCategoryLabel: () => (code: string) => code,
}));
vi.mock('@/hooks/useShipmentDetail', () => ({
  useShipmentDetail: (id?: number) => ({
    data: id ? { id, shipment_code: '0110007/26', export_code: null } : undefined,
  }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));
// The expenses tab and the multi-select fetch their own data; stubbed so this
// file tests the page's shipment mode, not those components.
vi.mock('@/components/customsExpense/CustomsExpensesTab', () => ({
  CustomsExpensesTab: ({ shipmentId }: { shipmentId?: number }) => (
    <div data-testid="expenses-tab">{shipmentId ?? 'all'}</div>
  ),
  CUSTOMS_EXPENSE_WRITE_ROLES: new Set(['finansist']),
}));
vi.mock('@/components/ShipmentMultiSelect', () => ({ ShipmentMultiSelect: () => <div /> }));
vi.mock('@/components/ShipmentSelect', () => ({ ShipmentSelect: () => <div /> }));

function renderAt(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <AdvancesTracker />
    </MemoryRouter>,
  );
}

describe('AdvancesTracker', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockUser.role = 'finansist';
    mockUseAdvances.mockReset();
    mockUseAdvances.mockReturnValue({
      data: { results: [], count: 0 },
      isLoading: false,
      isError: false,
    });
  });

  it('puts the statistics in their own tab', async () => {
    renderAt('/export/advances');

    expect(screen.queryByText('Advances total (in)')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Statistics' }));
    expect(screen.getByText('Advances total (in)')).toBeVisible();
    expect(screen.getByText('Total Advances')).toBeVisible();
  });

  it('opened from a shipment: shows only its rows, hides statistics, offers a new advance for it', async () => {
    renderAt('/export/advances?shipment=7');

    expect(mockUseAdvances).toHaveBeenCalledWith(expect.objectContaining({ shipment: 7 }));
    expect(screen.getByRole('alert')).toHaveTextContent('0110007/26');
    expect(screen.queryByRole('tab', { name: 'Statistics' })).toBeNull();
    // No advance for this shipment yet → the New advance form opens on it.
    expect(await screen.findByRole('dialog')).toHaveTextContent('0110007/26');
  });

  it('does not open the form when the shipment already has an advance', () => {
    mockUseAdvances.mockReturnValue({
      data: {
        results: [{
          id: 1, batch_code: 'ADV-1', advance_date: '2026-10-01', total_amount: 100,
          currency: 'TMT', purpose: null, shipment_count: 1, allocated_total: 0,
          reconciled: false, issued_by_name: 'f',
        }],
        count: 1,
      },
      isLoading: false,
      isError: false,
    });
    renderAt('/export/advances?shipment=7');

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
