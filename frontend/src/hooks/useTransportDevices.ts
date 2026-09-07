import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface ITransportDevice {
  traccar_id: number;
  plate: string | null;
  fleet_no: string | null;
  name: string;
}

/** The whole device registry, for the manual-override picker.
 *  `enabled` exists so a screen that renders the picker only for editors
 *  (ShipmentTruckLocationBlock) doesn't fetch the registry for everyone else. */
export function useTransportDevices({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<ITransportDevice[]>({
    queryKey: ['transport', 'devices'],
    queryFn: async () => {
      const { data } = await api.get<ITransportDevice[]>('/transport/devices/');
      return data;
    },
    staleTime: 5 * 60_000,
    enabled,
  });
}
