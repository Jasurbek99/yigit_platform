import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { PalletManifestPanel } from './PalletManifestPanel';

// Closing the manifest rewrites the truck's blocks; a block of another product
// is refused with 400 {error: 'product_mismatch'} and must reach the user.
const closeMutate = vi.fn((_v: unknown, opts?: { onError?: (err: unknown) => void }) => {
  opts?.onError?.({ response: { data: { error: 'product_mismatch' } } });
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/usePallets', () => ({
  usePallets: () => ({
    data: [{
      pallet_number: 1, crate_type: 1, crate_type_name: 'C', crate_count: 64,
      gross_weight_kg: '900', pallet_weight_kg: '7', additions_kg: '4',
      variety: 1, variety_name: 'V', sub_block: 1, sub_block_code: 'D', loaded_at: null,
      created_by_name: null,
    }],
    isLoading: false,
  }),
  useUpsertPallets: () => ({ mutate: vi.fn(), isPending: false }),
  useCloseManifest: () => ({ mutate: closeMutate, isPending: false }),
  useImportWeightmaster: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useAdmin', () => ({ useCrateTypes: () => ({ data: [] }) }));
vi.mock('./ManifestStats', () => ({ ManifestStats: () => null }));
vi.mock('./DistributionPills', () => ({ DistributionPills: () => null }));
vi.mock('./VarietyRollupCard', () => ({ VarietyRollupCard: () => null }));
vi.mock('./PalletTable', () => ({ PalletTable: () => null }));
vi.mock('@/components/BlockBreakdownCard', () => ({ BlockBreakdownCard: () => null }));

describe('PalletManifestPanel — close manifest', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the translated server error when closing fails', async () => {
    render(<PalletManifestPanel shipmentId={5} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close manifest' }));
    expect(closeMutate).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("The blocks' product does not match the trip's product");
  });
});
