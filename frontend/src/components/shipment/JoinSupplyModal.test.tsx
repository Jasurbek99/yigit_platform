import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { JoinSupplyModal } from './JoinSupplyModal';

const mutate = vi.fn();
vi.mock('@/hooks/useDrafts', () => ({
  useDrafts: () => ({
    data: [
      // supply candidate — has blocks, no destination name → included
      { id: 10, shipment_code: '0101010/26', weight_net: 22000, country_name: null, customer_name: null,
        block_sources: [{ block_id: 1, block_code: 'JA', weight_kg: null }] },
      // has blocks BUT a complete destination (both names set) → excluded
      { id: 20, shipment_code: '0202020/26', weight_net: 5000, country_name: 'KZ', customer_name: 'Begjan',
        block_sources: [{ block_id: 3, block_code: 'JC', weight_kg: null }] },
      // no blocks (destination-shaped) → excluded
      { id: 30, shipment_code: '0303030/26', weight_net: null, country_name: 'KZ', customer_name: 'Begjan',
        block_sources: [] },
      // is the target → excluded
      { id: 99, shipment_code: 'SELF/26', weight_net: null, country_name: null, customer_name: null,
        block_sources: [{ block_id: 2, block_code: 'JB', weight_kg: null }] },
    ],
    isLoading: false,
  }),
  useJoinShipments: () => ({ mutate, isPending: false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('JoinSupplyModal', () => {
  beforeEach(() => { mutate.mockClear(); i18n.changeLanguage('en'); });

  it('lists only supply candidates (has blocks, not a destination, not the target)', () => {
    wrap(<JoinSupplyModal open targetId={99} onClose={() => {}} />);
    expect(screen.getByText(/0101010\/26/)).toBeInTheDocument();       // supply — included
    expect(screen.queryByText(/0202020\/26/)).not.toBeInTheDocument(); // blocks+destination → excluded
    expect(screen.queryByText(/0303030\/26/)).not.toBeInTheDocument(); // no blocks → excluded
    expect(screen.queryByText(/SELF\/26/)).not.toBeInTheDocument();    // target → excluded
  });

  it('joins the picked supply into the target', async () => {
    wrap(<JoinSupplyModal open targetId={99} onClose={() => {}} />);
    await userEvent.click(screen.getByText(/0101010\/26/));
    await userEvent.click(screen.getByRole('button', { name: /join|birleş|объедин/i }));
    expect(mutate).toHaveBeenCalledWith(
      { targetId: 99, sourceId: 10 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
