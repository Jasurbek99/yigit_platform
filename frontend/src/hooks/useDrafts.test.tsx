import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '@/services/api';
import type { IDraftCreatePayload } from '@/types';
import { useCreateDraft, useDrafts } from './useDrafts';

vi.mock('@/services/api', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
// useDrafts() calls useSelectedSeason(), which needs react-router-dom's
// useSearchParams() — this file has no <Router> ancestor. Same pattern
// already used elsewhere for this reason (e.g. useSheetLiveSync.test.tsx).
vi.mock('@/hooks/useSeasonParam', () => ({
  useSelectedSeason: () => ({ seasonId: 1, isReady: true }),
}));

const DRAFT_PAYLOAD: IDraftCreatePayload = {
  is_draft: true,
  shipment_code: '1008001/26',
  date: '2026-08-10',
  block_sources: [{ block_id: 1, weight_kg: 18000 }],
};

describe('useCreateDraft cache invalidation', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  // GaplamaTruckForm (create mode) submits through this exact hook — the
  // Gaplama board's available_kg must be invalidated too, or a second truck
  // could be opened against capacity already claimed by the first (I2).
  it('invalidates the gaplama-board query on success', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 1 } });

    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    function localWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useCreateDraft(), { wrapper: localWrapper });
    result.current.mutate(DRAFT_PAYLOAD);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['gaplama-board'] });
  });
});

describe('useDrafts', () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  // GaplamaTruckForm's edit-mode seeding (task-7-report.md) reads
  // block_sources[].weight_kg straight off this hook's data and sums it
  // (blockTotal/totalKg). weight_kg is a DecimalField — it arrives as a
  // string ("8000.00", not 8000), same api-contract convention as every
  // other decimal field — so without coercion here, summing two rows
  // concatenates strings instead of adding numbers.
  it('coerces block_sources[].weight_kg from a decimal string to a number', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        results: [
          {
            id: 9, shipment_code: '2109001/26', date: '2026-09-21',
            created_at: '2026-09-21T08:00:00Z', created_by_name: 'Test User',
            weight_net: '8000.00', export_code: null, previous_platform_id: null,
            harvest_age_days: 0, freshness: 'today', variety_confidence: 'none',
            block_sources: [
              { block_id: 1, block_code: 'A', weight_kg: '3000.00', harvest_date: '2026-09-21' },
              { block_id: 1, block_code: 'A', weight_kg: '5000.00', harvest_date: '2026-09-24' },
            ],
          },
        ],
      },
    });

    const { result } = renderHook(() => useDrafts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const sources = result.current.data?.[0].block_sources ?? [];
    expect(sources.map((s) => s.weight_kg)).toEqual([3000, 5000]);
    // The bug this guards against: string concatenation instead of addition.
    expect(sources.reduce((sum, s) => sum + (s.weight_kg ?? 0), 0)).toBe(8000);
  });
});
