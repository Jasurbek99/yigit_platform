import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAdminTruckHeads, useUpdateTruckHead, useAdminDrivers, useUpdateDriver } from './useFleetAdmin';
import api from '@/services/api';

vi.mock('@/services/api');
function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useFleetAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('useAdminTruckHeads lists incl. inactive', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useAdminTruckHeads(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/transport/truck-heads/', { params: { include_inactive: 'true' } });
  });

  it('useUpdateTruckHead PATCHes by id', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 13 } });
    const { result } = renderHook(() => useUpdateTruckHead(), { wrapper });
    await result.current.mutateAsync({ id: 13, is_active: false });
    expect(api.patch).toHaveBeenCalledWith('/transport/truck-heads/13/', { is_active: false });
  });

  it('useAdminDrivers lists incl. inactive', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useAdminDrivers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/transport/drivers/', { params: { include_inactive: 'true' } });
  });

  it('useUpdateDriver PATCHes by id', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 5 } });
    const { result } = renderHook(() => useUpdateDriver(), { wrapper });
    await result.current.mutateAsync({ id: 5, is_active: false });
    expect(api.patch).toHaveBeenCalledWith('/transport/drivers/5/', { is_active: false });
  });
});
