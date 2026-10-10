import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import type { ILot, ILotDetail, ISale, ISaleInput } from '../types';
import { lotKey, LOTS_KEY } from './lotKeys';
import { useCreateExpenses, useCreateSale, useCreateSpoilage, useDeleteEntry } from './useLotEntries';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const LOT: ILot = {
  id: 7,
  shipment: { id: 5, code: '0000005/26', export_code: '10AP116/26', status_code: 'satylyar', product: null },
  seller: { id: 3, name: 'Айдос' },
  boxes_received: 100, boxes_per_pallet: 50, tare_g: 450, default_price_kg: '45.00', currency: 'KZT',
  opened_at: '2026-10-09T08:00:00+05:00', closed_at: null, needs_receipt: false, on_the_road: false,
  totals: {
    sold_boxes: 0, sold_kg: '0.00', spoiled_boxes: 0, spoiled_kg: '0.00', used: 0, left: 100,
    sales_total: '0.00', paid_total: '0.00', debt_total: '0.00', expenses_total: '0.00',
    after_expenses: '0.00', avg_price_kg: null,
  },
};

const SALE: ISale = {
  id: 11, unit: 'box', qty: 10, boxes: 10, gross_kg: '104.50', tare_g: 450, net_kg: '100.00', price_kg: '45.00',
  calc_total: '4500.00', total: '4500.00', paid_on_spot: true, buyer: null, sold_at: '2026-10-09T09:00:00+05:00',
  created_by: 3,
};

function setup(): { client: QueryClient; wrapper: (p: { children: ReactNode }) => ReactElement } {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const detail: ILotDetail = { ...LOT, sales: [], spoilage: [], expenses: [] };
  client.setQueryData(lotKey(7), detail);
  client.setQueryData([...LOTS_KEY, 'open'], [LOT]);
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const sold = { ...LOT, totals: { ...LOT.totals, sold_boxes: 10, left: 90 } };

describe('lot entry mutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a sale sends an Idempotency-Key, prepends the entry and keeps the detail lists', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { entry: SALE, lot: sold } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useCreateSale(7), { wrapper });
    await act(() => result.current.mutateAsync({
      unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', paid_on_spot: true,
    }));
    const [url, , config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/market/lots/7/sales/');
    expect(config?.headers?.['Idempotency-Key']).toEqual(expect.any(String));
    const detail = client.getQueryData<ILotDetail>(lotKey(7));
    expect(detail?.sales.map((s) => s.id)).toEqual([11]);
    expect(detail?.expenses).toEqual([]);
    expect(detail?.totals.left).toBe(90);
    expect(client.getQueryState([...LOTS_KEY, 'open'])?.isInvalidated).toBe(true);
  });

  it('uses a fresh key after a success', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { entry: SALE, lot: sold } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateSale(7), { wrapper });
    const body: ISaleInput = { unit: 'box', qty: 1, gross_kg: '10.00', price_kg: '45.00', paid_on_spot: true };
    await act(() => result.current.mutateAsync(body));
    // The key is read at render time: the next save comes after the success re-render.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(() => result.current.mutateAsync(body));
    const keys = vi.mocked(api.post).mock.calls.map((c) => c[2]?.headers?.['Idempotency-Key']);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('expenses read `entries` from the answer', async () => {
    const expense = { id: 21, category_id: 2, category_code: 'INTERES', label: '', amount: '12000.00',
      recorded_at: '2026-10-09T10:00:00+05:00', created_by: 3 };
    vi.mocked(api.post).mockResolvedValue({ data: { entries: [expense], lot: LOT } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useCreateExpenses(7), { wrapper });
    await act(() => result.current.mutateAsync([{ category_id: 2, amount: '12000.00' }]));
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ rows: [{ category_id: 2, amount: '12000.00' }] });
    expect(client.getQueryData<ILotDetail>(lotKey(7))?.expenses.map((e) => e.id)).toEqual([21]);
  });

  it('a delete removes the entry from the cached detail', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { entry: SALE, lot: sold } });
    vi.mocked(api.delete).mockResolvedValue({ data: { lot: LOT } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({ sale: useCreateSale(7), del: useDeleteEntry(7) }), { wrapper });
    await act(() => result.current.sale.mutateAsync({
      unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', paid_on_spot: true,
    }));
    await act(() => result.current.del.mutateAsync({ kind: 'sale', id: 11 }));
    const [url, config] = vi.mocked(api.delete).mock.calls[0];
    expect(url).toBe('/market/lots/7/sales/11/');
    expect(config?.headers?.['Idempotency-Key']).toEqual(expect.any(String));
    const detail = client.getQueryData<ILotDetail>(lotKey(7));
    expect(detail?.sales).toEqual([]);
    expect(detail?.totals.left).toBe(100);
  });

  it('a 5xx on a create refetches the lot detail and keeps the key; a 400 does neither', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce({ response: { status: 400, data: { qty: ['Мало'] } } })
      .mockRejectedValueOnce({ response: { status: 503, data: {} } })
      .mockRejectedValueOnce({ response: { status: 503, data: {} } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useCreateSpoilage(7), { wrapper });
    const send = (): Promise<unknown> => act(() => result.current.mutateAsync({ boxes: 1, gross_kg: null })
      .catch((e: unknown) => e));
    await send();
    expect(client.getQueryState(lotKey(7))?.isInvalidated).toBe(false);
    await send();
    expect(client.getQueryState(lotKey(7))?.isInvalidated).toBe(true);
    await send();
    const keys = vi.mocked(api.post).mock.calls.map((c) => c[2]?.headers?.['Idempotency-Key']);
    expect(new Set(keys).size).toBe(1);
  });
});
