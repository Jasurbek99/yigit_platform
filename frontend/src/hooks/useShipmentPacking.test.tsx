import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

vi.mock('@/services/api', () => ({
  default: { post: vi.fn(async () => ({ data: {} })) },
}));

import { useSetShipmentPacking } from './useShipmentPacking';
import { getShipmentDetailKey } from './useShipmentDetail';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useSetShipmentPacking — cache invalidation', () => {
  let client: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateSpy = vi.fn(async () => undefined);
    client.invalidateQueries = invalidateSpy as unknown as QueryClient['invalidateQueries'];
  });

  /**
   * Regression (E2E 2026-10-01): picking the template on the «Brutto/netto»
   * task card closed the task, but the card kept saying «0 of 1 fields
   * filled» — its progress reads the shipment detail, which was never
   * refetched.
   */
  it('refreshes the shipment detail the task card reads', async () => {
    const { result } = renderHook(() => useSetShipmentPacking(), { wrapper: wrapperFor(client) });

    result.current.mutate({ shipment: 7, scope: 'template', packing_template: 3 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidateSpy.mock.calls.map((call: unknown[]) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(getShipmentDetailKey(7));
  });
});
