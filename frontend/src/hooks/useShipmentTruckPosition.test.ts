import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useShipmentTruckPosition } from './useShipmentTruckPosition';
import api from '@/services/api';

vi.mock('@/services/api');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useShipmentTruckPosition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the shipment position', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { resolved_by: 'auto', device: { traccar_id: 67, plate: '4378AHF', fleet_no: 'TR050' },
              position: { lat: 37.9, lon: 58.4, is_online: true, is_stale: false } },
    });
    const { result } = renderHook(() => useShipmentTruckPosition(12), { wrapper });
    await waitFor(() => expect(result.current.data?.resolved_by).toBe('auto'));
    expect(api.get).toHaveBeenCalledWith('/transport/shipments/12/position/');
  });
});
