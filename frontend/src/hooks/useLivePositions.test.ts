import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useLivePositions } from './useLivePositions';
import api from '@/services/api';

vi.mock('@/services/api');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useLivePositions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the position rows from the API', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ device_id: 74, plate: '2189AHF', fleet_no: 'TR038', status: 'online',
               lat: 37.97, lon: 58.49, speed: 0, course: 298, address: 'Artyk',
               fix_time: '2026-07-30T05:26:28Z', is_online: true, is_stale: false }],
    });
    const { result } = renderHook(() => useLivePositions(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].plate).toBe('2189AHF');
    expect(api.get).toHaveBeenCalledWith('/transport/live-positions/');
  });
});
