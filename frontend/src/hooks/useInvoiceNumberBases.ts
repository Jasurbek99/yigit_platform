import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export interface IInvoiceNumberBaseRow {
  export_firm: number;
  export_firm_code: string;
  export_firm_name: string;
  year: number;
  last_number: number;
}

const KEY = 'invoice-number-bases';

/** Per-firm yearly invoice-number floors for one year (spec 2026-10-03 §6). */
export function useInvoiceNumberBases(year: number) {
  return useQuery({
    queryKey: [KEY, year] as const,
    queryFn: async () => {
      const { data } = await api.get<{ year: number; rows: IInvoiceNumberBaseRow[] }>(
        '/contracts/invoice-number-bases/',
        { params: { year } },
      );
      return data.rows;
    },
  });
}

export function useSaveInvoiceNumberBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { export_firm: number; year: number; last_number: number }) => {
      const { data } = await api.put<IInvoiceNumberBaseRow>('/contracts/invoice-number-bases/', body);
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: [KEY, row.year] });
    },
  });
}
