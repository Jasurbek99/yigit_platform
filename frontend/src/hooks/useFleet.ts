import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export interface ITruckHead {
  id: number;
  plate_number: string;
  owner_type: string;
  status: string;
  has_gps: boolean;
}

export interface ITrailer {
  id: number;
  plate_number: string;
  owner_type: string;
  status: string;
  is_active: boolean;
}

// Seeded from Z_TIRWEB with source ids preserved; `Shipment.driver_id` points
// into that same id space (see apps/export/models/shipment.py "=== Transport ===").
export interface IDriver {
  id: number;
  name: string;
  phone: string | null;
  is_active: boolean;
}

export function useTruckHeads(search?: string) {
  return useQuery<ITruckHead[]>({
    queryKey: ['transport', 'truck-heads', search ?? ''],
    queryFn: async () => {
      const params = search ? { search } : {};
      const { data } = await api.get<ITruckHead[]>('/transport/truck-heads/', { params });
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useTrailers(search?: string) {
  return useQuery<ITrailer[]>({
    queryKey: ['transport', 'trailers', search ?? ''],
    queryFn: async () => {
      const params = search ? { search } : {};
      const { data } = await api.get<ITrailer[]>('/transport/trailers/', { params });
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateTruckHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plate_number: string) => {
      const { data } = await api.post<ITruckHead>('/transport/truck-heads/', { plate_number });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transport', 'truck-heads'] }),
  });
}

export function useCreateTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plate_number: string) => {
      const { data } = await api.post<ITrailer>('/transport/trailers/', { plate_number });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transport', 'trailers'] }),
  });
}

// Picker feed — active-only on purpose. The admin tab passes
// `include_inactive=true`; a deactivated driver must not be offerable on a
// shipment.
export function useDrivers(search?: string) {
  return useQuery<IDriver[]>({
    queryKey: ['transport', 'drivers', search ?? ''],
    queryFn: async () => {
      const params = search ? { search } : {};
      const { data } = await api.get<IDriver[]>('/transport/drivers/', { params });
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.post<IDriver>('/transport/drivers/', { name });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'drivers'] });
      qc.invalidateQueries({ queryKey: ['transport', 'admin-drivers'] });
    },
  });
}
