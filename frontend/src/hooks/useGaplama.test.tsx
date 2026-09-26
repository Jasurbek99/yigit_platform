import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import { useGaplamaBoard, useUpdateTruckBlocks } from './useGaplama';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGaplamaBoard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts decimal strings to numbers', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        days: [{ date: '2026-09-21', block_id: 5, block_code: 'F', location: 'dusak',
                 plan_kg: '20000.00', loaded_kg: '12000.00', carried_in_kg: '0.00',
                 available_kg: '8000.00', over_kg: '0.00' }],
        trucks: [{ id: 1, shipment_code: '2109001/26', export_code: null, date: '2026-09-21',
                   status: 1, status_code: 'draft', status_display: 'Draft',
                   country: null, customer: null,
                   block_sources: [{ block_id: 5, block_code: 'F', weight_kg: '12000.00' }] }],
      },
    });
    const { result } = renderHook(() => useGaplamaBoard('2026-09-21', '2026-09-21'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.days[0].available_kg).toBe(8000);
    expect(typeof result.current.data?.days[0].available_kg).toBe('number');
    expect(result.current.data?.trucks[0].block_sources[0].weight_kg).toBe(12000);
  });

  it('requests the right endpoint and params', async () => {
    (api.get as any).mockResolvedValue({ data: { days: [], trucks: [] } });
    renderHook(() => useGaplamaBoard('2026-09-19', '2026-09-27'), { wrapper });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/export/gaplama/board/?from_date=2026-09-19&to_date=2026-09-27',
      ),
    );
  });

  it('coerces carried_out_kg, carry_in_breakdown[].kg and week_totals decimals', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        days: [{ date: '2026-09-22', block_id: 5, block_code: 'F', location: 'dusak',
                 plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '8000.00',
                 carry_in_breakdown: [{ origin_date: '2026-09-21', kg: '8000.00' }],
                 available_kg: '8000.00', over_kg: '0.00', carried_out_kg: '0.00' }],
        trucks: [],
        week_totals: [{ block_id: 5, block_code: 'F', location: 'dusak',
                        plan_kg: '10000.00', loaded_kg: '2000.00', over_kg: '0.00',
                        available_kg: '8000.00' }],
      },
    });
    const { result } = renderHook(() => useGaplamaBoard('2026-09-21', '2026-09-27'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const day = result.current.data?.days[0];
    expect(day?.carried_out_kg).toBe(0);
    expect(day?.carry_in_breakdown).toEqual([{ origin_date: '2026-09-21', kg: 8000 }]);
    expect(typeof day?.carry_in_breakdown[0].kg).toBe('number');

    const total = result.current.data?.week_totals[0];
    expect(total).toEqual({
      block_id: 5, block_code: 'F', location: 'dusak',
      plan_kg: 10000, loaded_kg: 2000, over_kg: 0, available_kg: 8000,
    });
  });

  it('defaults week_totals to [] when the backend omits it (empty-board responses)', async () => {
    (api.get as any).mockResolvedValue({ data: { days: [], trucks: [] } });
    const { result } = renderHook(() => useGaplamaBoard('2026-09-21', '2026-09-27'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.week_totals).toEqual([]);
  });

  it('coerces the batch age alongside kg', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        days: [{ date: '2026-06-03', block_id: 1, block_code: 'A', location: 'Duşak',
                 plan_kg: '9000', loaded_kg: '0', carried_in_kg: '4000',
                 carry_in_breakdown: [{ origin_date: '2026-06-01', kg: '4000', age_days: 2 }],
                 available_kg: '13000', over_kg: '0', carried_out_kg: '9000' }],
        trucks: [], week_totals: [],
      },
    });
    const { result } = renderHook(() => useGaplamaBoard('2026-06-03', '2026-06-03'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.days[0].carry_in_breakdown[0]).toEqual({
      origin_date: '2026-06-01', kg: 4000, age_days: 2,
    });
  });
});

describe('useUpdateTruckBlocks', () => {
  beforeEach(() => vi.clearAllMocks());

  function clientWrapper(client: QueryClient) {
    return function InnerWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
  }

  // I2: the Sheet and Drafts page read this same shipment through the
  // 'drafts'/'shipments' query keys, not just 'gaplama-board' — all three
  // must be invalidated or those surfaces stay stale after an edit.
  it('invalidates gaplama-board, drafts and shipments on success', async () => {
    (api.post as any).mockResolvedValue({ data: {} });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateTruckBlocks(), { wrapper: clientWrapper(client) });
    result.current.mutate({ shipmentId: 9, rows: [{ block_id: 1, weight_kg: 5000 }] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['gaplama-board'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['drafts'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shipments'] });
  });

  // 2026-09-25: the split and weight_net write is now ONE call
  // (sync_weight_net: true), atomic server-side — a rejected call writes
  // nothing, so there is no partial state to invalidate around. The board
  // (and drafts/shipments) must still refetch on failure so the UI drops
  // any optimistic state and shows the real current one.
  it('still invalidates gaplama-board, drafts and shipments when the call fails', async () => {
    (api.post as any).mockRejectedValue(new Error('403 forbidden'));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateTruckBlocks(), { wrapper: clientWrapper(client) });
    result.current.mutate({ shipmentId: 9, rows: [{ block_id: 1, weight_kg: 5000 }] });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['gaplama-board'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['drafts'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shipments'] });
  });

  // The split and its total must land in one call — a second, separate
  // PATCH would reopen the exact partial-write gap sync_weight_net exists
  // to close (2026-09-25).
  it('sends sync_weight_net: true and makes no separate weight_net call', async () => {
    (api.post as any).mockResolvedValue({ data: {} });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateTruckBlocks(), { wrapper: clientWrapper(client) });
    result.current.mutate({ shipmentId: 9, rows: [{ block_id: 1, weight_kg: 5000 }] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.post).toHaveBeenCalledWith('/export/shipments/9/block-sources/', {
      blocks: [{ block_id: 1, weight_kg: 5000 }],
      sync_weight_net: true,
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  // Gap 1 (task-7b-report.md's own Concerns section): without this, editing
  // a truck's batch split silently reverted to the old proportional-split
  // fallback server-side — the operator's new batch choice never reached the
  // request body at all.
  it('forwards harvest_date for each row so a batch edit does not silently revert', async () => {
    (api.post as any).mockResolvedValue({ data: {} });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateTruckBlocks(), { wrapper: clientWrapper(client) });
    result.current.mutate({
      shipmentId: 9,
      rows: [
        { block_id: 1, weight_kg: 3000, harvest_date: '2026-09-21' },
        { block_id: 1, weight_kg: 5000, harvest_date: '2026-09-24' },
      ],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.post).toHaveBeenCalledWith('/export/shipments/9/block-sources/', {
      blocks: [
        { block_id: 1, weight_kg: 3000, harvest_date: '2026-09-21' },
        { block_id: 1, weight_kg: 5000, harvest_date: '2026-09-24' },
      ],
      sync_weight_net: true,
    });
  });

  // 2026-09-25 (leftover-batch collapse): the leftover row's harvest_date is
  // an EXPLICIT null, not an omitted key — the two are different requests to
  // set_block_sources (views.py ~3310-3341): an explicit key (even null)
  // always overrides with a single dateless row, while an OMITTED key falls
  // into the "preserve existing batches, proportional-split" branch, which
  // reads the shipment's PRIOR block_sources and re-splits across THEM —
  // exactly the per-date rows this feature folds away. Omitting it here
  // would silently undo the fold on every save.
  it('forwards an explicit null harvest_date rather than omitting the key', async () => {
    (api.post as any).mockResolvedValue({ data: {} });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateTruckBlocks(), { wrapper: clientWrapper(client) });
    result.current.mutate({
      shipmentId: 9,
      rows: [{ block_id: 1, weight_kg: 5000, harvest_date: null }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.post).toHaveBeenCalledWith('/export/shipments/9/block-sources/', {
      blocks: [{ block_id: 1, weight_kg: 5000, harvest_date: null }],
      sync_weight_net: true,
    });
  });

  // A row with no harvest_date (a caller that never learned a batch date)
  // must still be a valid call — the field stays optional, matching the
  // backend's own "harvest_date is optional per-block" contract.
  it('still works when a row omits harvest_date', async () => {
    (api.post as any).mockResolvedValue({ data: {} });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateTruckBlocks(), { wrapper: clientWrapper(client) });
    result.current.mutate({ shipmentId: 9, rows: [{ block_id: 1, weight_kg: 5000 }] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.post).toHaveBeenCalledWith('/export/shipments/9/block-sources/', {
      blocks: [{ block_id: 1, weight_kg: 5000 }],
      sync_weight_net: true,
    });
  });
});
