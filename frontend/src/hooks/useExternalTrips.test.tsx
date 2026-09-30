import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import api from '@/services/api';
import { useCandidateShipments, useShipmentTrip } from './useExternalTrips';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/hooks/useSeasonParam', () => ({ useSelectedSeason: () => ({ seasonId: 4, isReady: true }) }));

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

describe('openTripDocument', () => {
  it('opens the tab inside the click, then points it at the PDF and frees the blob URL', async () => {
    vi.useFakeTimers();
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: revoke });
    vi.mocked(api.get).mockResolvedValueOnce({ data: new Blob(['%PDF']) });
    const { openTripDocument } = await import('./useExternalTrips');
    const pending = openTripDocument(3);
    expect(open).toHaveBeenCalledTimes(1); // synchronous: before the await resolves
    await pending;
    expect(tab.location.href).toBe('blob:x');
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers();
  });

  it('closes the empty tab when the PDF cannot be fetched', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    vi.mocked(api.get).mockRejectedValueOnce(new Error('502'));
    const { openTripDocument } = await import('./useExternalTrips');
    await expect(openTripDocument(3)).rejects.toThrow();
    expect(tab.close).toHaveBeenCalled();
  });
});

describe('useCandidateShipments', () => {
  it('asks for the season browsed in the header', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] });
    const { result } = renderHook(() => useCandidateShipments(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/transport/external-trips/candidate-shipments/', { params: { season: 4 } });
  });
});
