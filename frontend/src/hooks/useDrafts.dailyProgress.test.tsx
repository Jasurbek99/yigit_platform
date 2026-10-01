import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '@/services/api';
import type { IDraftCreatePayload } from '@/types';
import {
  useCreateDraft, useCreateExportPart, useJoinShipments, useSwapPackaging, useUnjoinPackaging,
} from './useDrafts';
import { useDailyProgress } from './useDailyProgress';

vi.mock('@/services/api', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/hooks/useSeasonParam', () => ({
  useSelectedSeason: () => ({ seasonId: 1, isReady: true }),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const invalidatedDailyProgress = () =>
    invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === 'daily-progress');
  return { client, wrapper, invalidatedDailyProgress };
}

function keyOf(callIndex: number): string | undefined {
  const config = vi.mocked(api.post).mock.calls[callIndex]?.[2];
  return config?.headers?.['Idempotency-Key'] as string | undefined;
}

const DRAFT: IDraftCreatePayload = {
  is_draft: true, shipment_code: '0110001/26', date: '2026-10-01',
  block_sources: [{ block_id: 1, weight_kg: 18000 }],
};

describe('plan strips refresh after the actions they count', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({ data: { id: 1, new_supply_id: 2, new_supply_code: 'X', shipments: [] } });
  });

  it('opening a truck (Gaplama «+ Tır Aç») refreshes daily progress', async () => {
    const { wrapper, invalidatedDailyProgress } = setup();
    const { result } = renderHook(() => useCreateDraft(), { wrapper });
    result.current.mutate(DRAFT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedDailyProgress()).toBe(true);
  });

  it('join, unjoin and swap refresh daily progress', async () => {
    for (const run of [
      (w: ReturnType<typeof setup>['wrapper']) => {
        const h = renderHook(() => useJoinShipments(), { wrapper: w });
        h.result.current.mutate({ targetId: 1, sourceId: 2 });
        return h;
      },
      (w: ReturnType<typeof setup>['wrapper']) => {
        const h = renderHook(() => useUnjoinPackaging(), { wrapper: w });
        h.result.current.mutate(1);
        return h;
      },
      (w: ReturnType<typeof setup>['wrapper']) => {
        const h = renderHook(() => useSwapPackaging(), { wrapper: w });
        h.result.current.mutate({ aId: 1, otherId: 2 });
        return h;
      },
    ]) {
      const { wrapper, invalidatedDailyProgress } = setup();
      const { result } = run(wrapper);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidatedDailyProgress()).toBe(true);
    }
  });

  it('daily progress also polls, like the task list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { date: '2026-10-01', days: [] } });
    const { client, wrapper } = setup();
    renderHook(() => useDailyProgress(), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const query = client.getQueryCache().find({ queryKey: ['daily-progress', 'today', 1] });
    expect(query?.options).toMatchObject({ refetchInterval: 60_000 });
  });
});

describe('«+» on the plan strip keys each row separately', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it('a failed RU «+» does not hand its key to the Gapy «+»', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateExportPart(), { wrapper });

    result.current.mutate({ country: 3 });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    result.current.mutate({ isGapy: true });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).toBeDefined();
    expect(keyOf(1)).toBeDefined();
    expect(keyOf(0)).not.toBe(keyOf(1));
  });

  it('retrying the same row after a failure reuses its key', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateExportPart(), { wrapper });

    result.current.mutate({ country: 3 });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    result.current.mutate({ country: 3 });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).toBe(keyOf(1));
  });

  it('a second part for the same row after a success gets a fresh key', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 5 } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateExportPart(), { wrapper });

    result.current.mutate({ country: 3 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    result.current.mutate({ country: 3 });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).not.toBe(keyOf(1));
  });
});
