import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTruckHeads, useTrailers } from './useFleet';
import api from '@/services/api';

vi.mock('@/services/api');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useFleet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('useTruckHeads fetches the list', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: 13, plate_number: '3269AHF', owner_type: 'company', status: 'idle', has_gps: true }],
    });
    const { result } = renderHook(() => useTruckHeads(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].plate_number).toBe('3269AHF');
    expect(api.get).toHaveBeenCalledWith('/transport/truck-heads/', { params: {} });
  });

  it('useTrailers passes the search param', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useTrailers('2602'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/transport/trailers/', { params: { search: '2602' } });
  });
});
