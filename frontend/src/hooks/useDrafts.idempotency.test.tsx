import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '@/services/api';
import type { IDraftCreatePayload } from '@/types';
import { useCreateDraft, useCreateEmptyColumn } from './useDrafts';

vi.mock('@/services/api', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function keyOf(callIndex: number): string | undefined {
  const config = vi.mocked(api.post).mock.calls[callIndex]?.[2];
  return config?.headers?.['Idempotency-Key'] as string | undefined;
}

const DRAFT_PAYLOAD: IDraftCreatePayload = {
  is_draft: true,
  shipment_code: '1008001/26',
  date: '2026-08-10',
  block_sources: [{ block_id: 1, weight_kg: 18000 }],
};

describe('draft creates carry idempotency keys', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it('reuses ONE key when the same mutation is submitted twice', async () => {
    // Reject both calls so onSuccess never fires and reset() never runs —
    // this is exactly the timeout-then-retry case the feature exists for.
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useCreateDraft(), { wrapper });

    result.current.mutate(DRAFT_PAYLOAD);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    result.current.mutate(DRAFT_PAYLOAD);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).toBeDefined();
    expect(keyOf(0)).toBe(keyOf(1));
  });

  it('uses DIFFERENT keys for two DIFFERENT draft mutations', async () => {
    // This is the test that matters. The one above passes even if the key is
    // hoisted to module scope; only this one catches that mistake.
    vi.mocked(api.post).mockResolvedValue({ data: { id: 1 } });
    const draft = renderHook(() => useCreateDraft(), { wrapper });
    const column = renderHook(() => useCreateEmptyColumn(), { wrapper });

    draft.result.current.mutate(DRAFT_PAYLOAD);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    column.result.current.mutate();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).toBeDefined();
    expect(keyOf(1)).toBeDefined();
    expect(keyOf(0)).not.toBe(keyOf(1));
  });
});
