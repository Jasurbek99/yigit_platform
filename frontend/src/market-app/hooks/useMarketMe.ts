import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import type { UserRole } from '@/types';

interface IMarketRef {
  id: number;
  name: string;
}

/** GET /market/me/ — who is using the market app and for which agent / bazaar. */
export interface IMarketMe {
  role: UserRole;
  username: string;
  first_name: string;
  customer: IMarketRef | null;
  bazaar: IMarketRef | null;
}

export function useMarketMe(): UseQueryResult<IMarketMe> {
  return useQuery({
    queryKey: ['market', 'me'],
    queryFn: async () => (await api.get<IMarketMe>('/market/me/')).data,
    staleTime: 5 * 60_000,
  });
}
