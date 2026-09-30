import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import api from '@/services/api';
import { useShipmentTrip } from './useExternalTrips';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useShipmentTrip', () => {
  it('reads the per-shipment endpoint, open to every role', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { id: 3 } });
    const { result } = renderHook(() => useShipmentTrip(7), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ id: 3 }));
    expect(api.get).toHaveBeenCalledWith('/transport/shipments/7/trip/');
  });

  it('is null when the shipment has no trip (404)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } }));
    const { result } = renderHook(() => useShipmentTrip(8), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
