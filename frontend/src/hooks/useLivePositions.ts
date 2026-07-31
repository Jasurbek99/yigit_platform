import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface ILivePosition {
  device_id: number;
  plate: string | null;
  fleet_no: string | null;
  status: string;
  lat: number;
  lon: number;
  speed: number | null;
  course: number | null;
  address: string | null;
  fix_time: string | null;
  is_online: boolean;
  is_stale: boolean;
}

export function useLivePositions() {
  return useQuery<ILivePosition[]>({
    queryKey: ['transport', 'live-positions'],
    queryFn: async () => {
      const { data } = await api.get<ILivePosition[]>('/transport/live-positions/');
      return data;
    },
    refetchInterval: 30_000,
  });
}
