import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export type LetterType = 'ct1' | 'fito' | 'customs';

export interface ILetterNumberBaseRow {
  export_firm: number;
  export_firm_code: string;
  export_firm_name: string;
  year: number;
  ct1: number;
  fito: number;
  customs: number;
}

const KEY = 'letter-number-bases';

/** Per-firm yearly CT-1 / Fito / ARZA number floors for one year (spec 2026-10-05). */
export function useLetterNumberBases(year: number) {
  return useQuery({
    queryKey: [KEY, year] as const,
    queryFn: async () => {
      const { data } = await api.get<{ year: number; rows: ILetterNumberBaseRow[] }>(
        '/contracts/letter-number-bases/',
        { params: { year } },
      );
      return data.rows;
    },
  });
}

export function useSaveLetterNumberBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { export_firm: number; year: number; letter_type: LetterType; last_number: number }) => {
      const { data } = await api.put<ILetterNumberBaseRow>('/contracts/letter-number-bases/', body);
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: [KEY, row.year] });
    },
  });
}
