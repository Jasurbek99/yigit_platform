import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { JoinDraftsModal } from './JoinDraftsModal';

const mutate = vi.fn();
vi.mock('@/hooks/useDrafts', () => ({ useJoinShipments: () => ({ mutate, isPending: false }) }));
vi.mock('@/hooks/useShipmentDetail');
import { useShipmentDetail } from '@/hooks/useShipmentDetail';

const destination = {
  id: 1, shipment_code: 'DEST/26', status_code: 'draft',
  country: 10, customer: 20, country_name: 'KZ', customer_name: 'Almaty',
  block_sources: [], weight_net: null,
};
const supply = {
  id: 2, shipment_code: 'SUP/26', status_code: 'draft',
  country: null, customer: null, country_name: null, customer_name: null,
  block_sources: [{ block_id: 5, block_code: 'B1', weight_kg: null }], weight_net: 9000,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubDetail(byId: Record<number, any>) {
  vi.mocked(useShipmentDetail).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((id: any) => ({ data: id == null ? undefined : byId[id], isLoading: false, isError: false })) as any,
  );
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('JoinDraftsModal', () => {
  beforeEach(() => { mutate.mockReset(); i18n.changeLanguage('en'); });

  it('auto-detects direction and joins supply into destination regardless of id order', async () => {
    stubDetail({ 1: destination, 2: supply });
    // draftIds order [supply, destination] — direction must still resolve correctly
    wrap(<JoinDraftsModal open draftIds={[2, 1]} onClose={() => {}} />);
    expect(screen.getByText('DEST/26')).toBeInTheDocument();
    expect(screen.getByText('SUP/26')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^join$|birleş|объедин/i }));
    expect(mutate).toHaveBeenCalledWith(
      { targetId: 1, sourceId: 2 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('two supply-shaped drafts → ambiguity message, confirm disabled, no mutate', async () => {
    const supply2 = { ...supply, id: 3, shipment_code: 'SUP2/26', block_sources: [{ block_id: 8, block_code: 'B2', weight_kg: null }] };
    stubDetail({ 2: supply, 3: supply2 });
    wrap(<JoinDraftsModal open draftIds={[2, 3]} onClose={() => {}} />);
    expect(screen.getByText(/can't tell which draft is the destination/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /^join$|birleş|объедин/i });
    expect(confirm).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('surfaces the backend error message on failure', async () => {
    const { toast } = await import('sonner');
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    mutate.mockImplementation((_args, opts) => {
      opts.onError({ response: { data: { error: 'Target already has supply blocks' } } });
    });
    stubDetail({ 1: destination, 2: supply });
    wrap(<JoinDraftsModal open draftIds={[1, 2]} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /^join$|birleş|объедин/i }));
    expect(errorSpy).toHaveBeenCalledWith('Target already has supply blocks');
  });

  it('shows a spinner while the details are loading', () => {
    vi.mocked(useShipmentDetail).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (() => ({ data: undefined, isLoading: true, isError: false })) as any,
    );
    wrap(<JoinDraftsModal open draftIds={[1, 2]} onClose={() => {}} />);
    // antd Modal renders via a portal to document.body — not inside RTL's
    // `container` div — so the spinner must be queried from document.body.
    expect(document.body.querySelector('.ant-spin')).toBeInTheDocument();
  });
});
