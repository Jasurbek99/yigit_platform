import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import api from '@/services/api';
import { IDEMPOTENCY_HEADER } from '@/hooks/useIdempotencyKey';
import { httpStatus } from '@/utils/drfErrors';
import type { IPaymentInput, IPaymentWrite } from '../types';
import { refetchAfterPayment } from './debtKeys';
import { useTargetKey } from './useTargetKey';

/**
 * POST /market/payments/ → `{payment, debts_total}`. The server replays a key without comparing
 * bodies, so the key follows buyer, currency and amount: a retry of the same payment replays,
 * a different payment gets its own key.
 */
export function useCreatePayment(): UseMutationResult<IPaymentWrite, unknown, IPaymentInput> {
  const queryClient = useQueryClient();
  const idem = useTargetKey();
  return useMutation({
    mutationFn: async (body: IPaymentInput) => (
      await api.post<IPaymentWrite>('/market/payments/', body, {
        headers: { [IDEMPOTENCY_HEADER]: idem.keyFor(`${body.buyer_id}|${body.currency}|${body.amount}`) },
      })
    ).data,
    onSuccess: () => {
      idem.reset();
      refetchAfterPayment(queryClient);
    },
    // A 5xx may have come after the commit: show what the server has.
    onError: (err) => {
      if ((httpStatus(err) ?? 0) >= 500) refetchAfterPayment(queryClient);
    },
  });
}

/** DELETE /market/payments/{id}/ → `{deleted}` (no lot payload): the debts and lots are refetched. */
export function useDeletePayment(): UseMutationResult<unknown, unknown, number> {
  const queryClient = useQueryClient();
  const idem = useTargetKey();
  return useMutation({
    mutationFn: async (id: number) => (
      await api.delete(`/market/payments/${id}/`, { headers: { [IDEMPOTENCY_HEADER]: idem.keyFor(String(id)) } })
    ).data,
    onSuccess: () => {
      idem.reset();
      refetchAfterPayment(queryClient);
    },
    onError: (err) => {
      if ((httpStatus(err) ?? 0) >= 500) refetchAfterPayment(queryClient);
    },
  });
}
