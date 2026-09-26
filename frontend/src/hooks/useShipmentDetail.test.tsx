import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import api from '@/services/api';
import { getShipmentDetailKey, useShipmentDetail } from './useShipmentDetail';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

/**
 * Regression: the /me/board task drawer passes `task.shipment` (a NUMBER) to
 * useShipmentDetail, while every mutation invalidates ['shipment', String(id)].
 * TanStack compares key parts type-strictly, so 42 !== '42' — the invalidation
 * missed, the detail cache stayed stale, and the drawer's progress bar only
 * moved after close + reopen (remount refetch).
 */
describe('getShipmentDetailKey', () => {
  it('normalises a numeric id to the string form used by every invalidation site', () => {
    expect(getShipmentDetailKey(42)).toEqual(['shipment', '42']);
  });

  it('leaves a string id untouched', () => {
    expect(getShipmentDetailKey('42')).toEqual(['shipment', '42']);
  });

  it('preserves undefined so the query stays disabled', () => {
    expect(getShipmentDetailKey(undefined)).toEqual(['shipment', undefined]);
  });

  it('is invalidated by a String(id) invalidation when the caller passed a number', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(getShipmentDetailKey(42), { id: 42 });

    void queryClient.invalidateQueries({ queryKey: ['shipment', String(42)] });

    const state = queryClient.getQueryState(getShipmentDetailKey(42));
    expect(state?.isInvalidated).toBe(true);
  });

  it('documents the old bug: a raw numeric key is NOT matched by String(id)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['shipment', 42], { id: 42 });

    void queryClient.invalidateQueries({ queryKey: ['shipment', String(42)] });

    expect(queryClient.getQueryState(['shipment', 42])?.isInvalidated).toBe(false);
  });
});

describe('useShipmentDetail block_sources weight_kg coercion', () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  // block_sources[].weight_kg is a DecimalField — arrives as a string
  // ("8000.00", not 8000), same api-contract convention as every other
  // decimal field. ShipmentGoodsBody's per-batch breakdown formats it with
  // fmtNum, which needs a real number — without coercion here it renders
  // the raw string untouched instead of a formatted number.
  it('coerces block_sources[].weight_kg from a decimal string to a number', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        id: 1,
        block_sources: [
          { block_code: 'A', block_name: 'A', weight_kg: '3000.00', harvest_date: '2026-09-21' },
          { block_code: 'A', block_name: 'A', weight_kg: '5000.00', harvest_date: '2026-09-24' },
        ],
      },
    });

    const { result } = renderHook(() => useShipmentDetail(1), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const sources = result.current.data?.block_sources ?? [];
    expect(sources.map((s) => s.weight_kg)).toEqual([3000, 5000]);
  });

  it('preserves a null weight_kg as null rather than coercing it to 0', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        id: 1,
        block_sources: [{ block_code: 'A', block_name: 'A', weight_kg: null, harvest_date: null }],
      },
    });

    const { result } = renderHook(() => useShipmentDetail(1), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.block_sources[0].weight_kg).toBeNull();
  });
});
