import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

interface IMarketRef {
  id: number;
  name: string;
}

/** GET /market/me/ — who is using the market app and for which agent / bazaar. */
export interface IMarketMe {
  role: 'agent' | 'agent_seller' | string;
  customer: IMarketRef | null;
  bazaar: IMarketRef | null;
}

export function useMarketMe() {
  return useQuery({
    queryKey: ['market', 'me'],
    queryFn: async () => (await api.get<IMarketMe>('/market/me/')).data,
    staleTime: 5 * 60_000,
  });
}

/** First name for the header — /market/me/ does not carry it, /auth/me/ does. */
export function useMarketUserName() {
  return useQuery({
    queryKey: ['auth', 'me', 'first_name'],
    queryFn: async () => (await api.get<{ first_name: string; username: string }>('/auth/me/')).data,
    select: (user) => user.first_name || user.username,
    staleTime: 5 * 60_000,
  });
}
