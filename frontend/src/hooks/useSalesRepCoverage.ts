import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ISalesRepCoverage } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const QUERY_KEY = ['sales-rep-coverage'] as const;

export function useSalesRepCoverage() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<ISalesRepCoverage[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<ISalesRepCoverage[]>(
        '/export/sales-rep-coverage/',
      );
      return data;
    },
    staleTime: 60_000,
  });
}

interface ISaveCoveragePayload {
  readonly userId: number;
  readonly customerIds: number[];
}

export function useSaveSalesRepCoverage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, customerIds }: ISaveCoveragePayload) =>
      api.put(`/export/sales-rep-coverage/${userId}/`, { customer_ids: customerIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // Customer.sales_rep changes on the backend — keep the customer list fresh
      void queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
      void queryClient.invalidateQueries({ queryKey: ['core-customers'] });
    },
  });
}
