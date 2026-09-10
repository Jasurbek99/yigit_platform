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
  /** Logo accounting identity, owned by the import — read-only on the API. */
  logo_ref: string;
  driver_logo_code: string;
  is_active: boolean;
  /**
   * Passport identity. Absent for every role that cannot edit the fleet: the
   * backend swaps in a serializer without these fields, because the driver
   * pickers read the same `/transport/drivers/` route as the admin screen.
   */
  passport_serial?: string;
  passport_issue_date?: string | null;
  document_count?: number;
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

// `useCreateTruckHead` was removed on 2026-09-10, for the same reason as
// `useCreateDriver` below: it POSTed a plate alone, and a truck head now needs a
// `truck_model` to exist. Truck heads are created in Fleet Management.
//
// `useCreateTrailer` stays — a trailer has no required field beyond its plate,
// so the picker's inline add still works there.

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

// `useCreateDriver` was removed on 2026-09-10. It POSTed a name alone, which
// the API now rejects: a driver needs a passport serial and issue date to
// exist. Drivers are created in Fleet Management, where those fields and the
// passport scan live — see `FleetDriversTab`.
