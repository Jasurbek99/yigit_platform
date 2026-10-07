import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(async () => ({ data: {} })), get: vi.fn(async () => ({ data: [] })) },
}));

import { useUpdateTomatoVariety } from './useAdmin';

describe('useUpdateTomatoVariety — cache invalidation', () => {
  // A variety's product decides its blocks' product (weekly plan tag + totals),
  // so the block lists must refetch after the change.
  it('invalidates the block queries as well as varieties', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.fn(async () => undefined);
    client.invalidateQueries = spy as unknown as QueryClient['invalidateQueries'];
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useUpdateTomatoVariety(), { wrapper });
    result.current.mutate({ id: 1, product_type: 2 } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = spy.mock.calls.map((c: unknown[]) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(keys).toContain('core-blocks');
    expect(keys).toContain('admin-blocks-full');
  });
});
