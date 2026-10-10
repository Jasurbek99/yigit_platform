import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import api from '@/services/api';
import type { IExpenseCategory } from '../types';

/** GET /market/expense-categories/ (plain array, market order) — rarely changes. */
export function useExpenseCategories(): UseQueryResult<IExpenseCategory[]> {
  return useQuery({
    queryKey: ['market', 'expense-categories'],
    queryFn: async () => (await api.get<IExpenseCategory[]>('/market/expense-categories/')).data,
    staleTime: 60 * 60_000,
  });
}
