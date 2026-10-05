import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export type LetterNumberField = 'ct1_number' | 'fito_number' | 'customs_number';

/** Hand-correct one CT-1 / Fito / ARZA number on a sale (spec 2026-10-05 §4). */
export function useSaveLetterNumber(saleId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Record<LetterNumberField, number>>) => {
      const { data } = await api.patch(`/contracts/sales/${saleId}/letter-numbers/`, body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-packets'] });
    },
  });
}
