import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

vi.mock('@/services/api', () => ({
  default: {
    post: vi.fn(async () => ({ data: { count: 0, next: null, previous: null, results: [] } })),
    get: vi.fn(async () => ({ data: [] })),
    patch: vi.fn(async () => ({ data: {} })),
  },
}));

vi.mock('@/hooks/useSeasonParam', () => ({
  useSelectedSeason: () => ({ seasonId: 1, isReady: true }),
}));

import { useInitializeWeek } from './usePlanning';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useInitializeWeek — cache invalidation', () => {
  let client: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Replace rather than spy: `invalidateQueries` is generic, and a typed
    // spy handle on it does not narrow to a plain mock signature.
    invalidateSpy = vi.fn(async () => undefined);
    client.invalidateQueries = invalidateSpy as unknown as QueryClient['invalidateQueries'];
  });

  /**
   * Regression (2026-08-20): initialize-week creates the seven Mon–Sun
   * HarvestDayEntry rows as well as the plans — those rows ARE the grid's
   * editable cells. Invalidating only ['harvest-plans'] left ['day-entries']
   * on its stale empty cache, so the block rows appeared but every cell
   * rendered as a dead `—` span with no click handler. Reported as "boss can
   * initialize but can't enter data"; only a page reload cleared it.
   */
  it('invalidates day-entries as well as harvest-plans', async () => {
    const { result } = renderHook(() => useInitializeWeek(), { wrapper: wrapperFor(client) });

    result.current.mutate({ season: 1, week_number: 34, year: 2026 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call: unknown[]) => (call[0] as { queryKey: unknown[] }).queryKey[0],
    );
    expect(invalidatedKeys).toContain('harvest-plans');
    expect(invalidatedKeys).toContain('day-entries');
  });
});
