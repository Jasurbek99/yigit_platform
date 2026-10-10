import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import type { IDebts } from '../types';
import { DEBTS_KEY } from './debtKeys';

/** GET /market/debts/ — who owes what over the caller's lots, per buyer and currency. */
export function useDebts(): UseQueryResult<IDebts> {
  return useQuery({
    queryKey: DEBTS_KEY,
    queryFn: async () => (await api.get<IDebts>('/market/debts/')).data,
  });
}
