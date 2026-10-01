import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

/** The shipment a truck carries now: open, dated in the last 30 days; a
 *  «Подготовка» plan only when the truck has no loaded shipment. */
export interface ILiveShipment {
  id: number;
  code: string;
  export_code: string | null;
  status_code: string;
  country_code: string | null;
  country_name: string | null;
  import_firm_name: string | null;
  export_firms_display: string | null;
}

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
  /** When our poller last wrote this row — max() across rows is the page's
   *  "last sync" stamp. Distinct from `fix_time` (when the GPS reported). */
  updated_at: string;
  is_online: boolean;
  is_stale: boolean;
  /** Name of the Traccar geofence the truck is in now, null if none. */
  geofence_name: string | null;
  /** When our poller first saw the truck in `geofence_name` (not Traccar's
   *  enter event) — understates dwell right after a deploy. Null with `geofence_name`. */
  geofence_since: string | null;
  shipment: ILiveShipment | null;
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
