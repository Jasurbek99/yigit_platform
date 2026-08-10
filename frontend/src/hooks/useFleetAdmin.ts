import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ITruckHead, ITrailer } from './useFleet';

export function useAdminTruckHeads() {
  return useQuery<ITruckHead[]>({
    queryKey: ['transport', 'admin-truck-heads'],
    queryFn: async () => {
      const { data } = await api.get<ITruckHead[]>('/transport/truck-heads/', {
        params: { include_inactive: 'true' },
      });
      return data;
    },
  });
}

export function useAdminTrailers() {
  return useQuery<ITrailer[]>({
    queryKey: ['transport', 'admin-trailers'],
    queryFn: async () => {
      const { data } = await api.get<ITrailer[]>('/transport/trailers/', {
        params: { include_inactive: 'true' },
      });
      return data;
    },
  });
}

interface ITruckHeadPatch { id: number; plate_number?: string; owner_type?: string; owner_name?: string; status?: string; capacity?: number | null; is_active?: boolean; }
interface ITrailerPatch { id: number; plate_number?: string; owner_type?: string; status?: string; is_active?: boolean; }

export function useUpdateTruckHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ITruckHeadPatch) => {
      const { data } = await api.patch<ITruckHead>(`/transport/truck-heads/${id}/`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-truck-heads'] });
      qc.invalidateQueries({ queryKey: ['transport', 'truck-heads'] });
    },
  });
}

export function useUpdateTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ITrailerPatch) => {
      const { data } = await api.patch<ITrailer>(`/transport/trailers/${id}/`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-trailers'] });
      qc.invalidateQueries({ queryKey: ['transport', 'trailers'] });
    },
  });
}
