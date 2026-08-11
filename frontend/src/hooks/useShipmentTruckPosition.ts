import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export interface ITruckPosition {
  lat: number;
  lon: number;
  speed: number | null;
  course: number | null;
  address: string | null;
  fix_time: string | null;
  is_online: boolean;
  is_stale: boolean;
}

export interface ITruckPositionResult {
  resolved_by: 'manual' | 'auto' | 'none';
  device: { traccar_id: number; plate: string | null; fleet_no: string | null } | null;
  position: ITruckPosition | null;
}

export function useShipmentTruckPosition(shipmentId: number) {
  return useQuery<ITruckPositionResult>({
    queryKey: ['transport', 'shipment-position', shipmentId],
    queryFn: async () => {
      const { data } = await api.get<ITruckPositionResult>(
        `/transport/shipments/${shipmentId}/position/`,
      );
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useSetShipmentDevice(shipmentId: number) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['transport', 'shipment-position', shipmentId] });
  const set = useMutation({
    mutationFn: (traccarId: number) =>
      api.put(`/transport/shipments/${shipmentId}/device/`, { traccar_id: traccarId }),
    onSuccess: invalidate,
  });
  const clear = useMutation({
    mutationFn: () => api.delete(`/transport/shipments/${shipmentId}/device/`),
    onSuccess: invalidate,
  });
  return { set, clear };
}
