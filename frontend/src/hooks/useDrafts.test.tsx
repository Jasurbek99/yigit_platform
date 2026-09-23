import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '@/services/api';
import type { IDraftCreatePayload } from '@/types';
import { useCreateDraft } from './useDrafts';

vi.mock('@/services/api', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
