import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import { useGaplamaBoard } from './useGaplama';

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
});
