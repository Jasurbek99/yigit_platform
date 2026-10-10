import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import type { IMarketShipment } from '../types';
import { SHIPMENTS_KEY } from './lotKeys';

/** GET /market/shipments/ (plain array) — the agent's trucks, arrived first, then in transit. */
export function useMarketShipments(): UseQueryResult<IMarketShipment[]> {
  return useQuery({
    queryKey: SHIPMENTS_KEY,
    queryFn: async () => (await api.get<IMarketShipment[]>('/market/shipments/')).data,
  });
}
