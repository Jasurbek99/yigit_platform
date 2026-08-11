import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface ITransportDevice {
  traccar_id: number;
  plate: string | null;
  fleet_no: string | null;
  name: string;
}

export function useTransportDevices() {
  return useQuery<ITransportDevice[]>({
    queryKey: ['transport', 'devices'],
    queryFn: async () => {
      const { data } = await api.get<ITransportDevice[]>('/transport/devices/');
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
