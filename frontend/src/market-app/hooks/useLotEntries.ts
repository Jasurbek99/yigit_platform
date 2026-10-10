import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import api from '@/services/api';
import { IDEMPOTENCY_HEADER, useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import type {
  EntryKind, IEntryWrite, IExpenseRowInput, IExpensesWrite, ILotDetail, ILotWrite, ISale, ISaleInput,
  ISpoilage, ISpoilageInput,
} from '../types';
import { applyLot, refetchAfterServerError } from './lotKeys';

const lotUrl = (lotId: number): string => `/market/lots/${lotId}/`;

/** URL segment of each entry kind (also the name of its list in ILotDetail). */
const SEGMENT: Record<EntryKind, string> = { sale: 'sales', spoilage: 'spoilage', expense: 'expenses' };

/**
 * `added` on top of `list`, without copies: after a 5xx the refetch may already hold the entry,
 * and the retry under the same key replays it.
 */
function prepend<T extends { id: number }>(added: T[], list: T[]): T[] {
  const ids = new Set(added.map((e) => e.id));
  return [...added, ...list.filter((e) => !ids.has(e.id))];
}

/** POST …/sales/ → `{entry, lot}`; the sale goes to the top of the cached detail. */
export function useCreateSale(lotId: number): UseMutationResult<IEntryWrite<ISale>, unknown, ISaleInput> {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async (body: ISaleInput) => (
      await api.post<IEntryWrite<ISale>>(`${lotUrl(lotId)}sales/`, body, {
        headers: { [IDEMPOTENCY_HEADER]: idem.key },
      })
    ).data,
    onSuccess: ({ entry, lot }) => {
      idem.reset();
      applyLot(queryClient, lot, (d) => ({ sales: prepend([entry], d.sales) }));
    },
    // The key is kept: a retry of a save that did go through replays it.
    onError: (err) => refetchAfterServerError(queryClient, lotId, err),
  });
}

/** POST …/spoilage/ → `{entry, lot}`. */
export function useCreateSpoilage(lotId: number): UseMutationResult<IEntryWrite<ISpoilage>, unknown, ISpoilageInput> {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async (body: ISpoilageInput) => (
      await api.post<IEntryWrite<ISpoilage>>(`${lotUrl(lotId)}spoilage/`, body, {
        headers: { [IDEMPOTENCY_HEADER]: idem.key },
      })
    ).data,
    onSuccess: ({ entry, lot }) => {
      idem.reset();
      applyLot(queryClient, lot, (d) => ({ spoilage: prepend([entry], d.spoilage) }));
    },
    // The key is kept: a retry of a save that did go through replays it.
    onError: (err) => refetchAfterServerError(queryClient, lotId, err),
  });
}

/** POST …/expenses/ `{rows}` → `{entries, lot}` (one sheet, several rows). */
export function useCreateExpenses(lotId: number): UseMutationResult<IExpensesWrite, unknown, IExpenseRowInput[]> {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async (rows: IExpenseRowInput[]) => (
      await api.post<IExpensesWrite>(`${lotUrl(lotId)}expenses/`, { rows }, {
        headers: { [IDEMPOTENCY_HEADER]: idem.key },
      })
    ).data,
    onSuccess: ({ entries, lot }) => {
      idem.reset();
      applyLot(queryClient, lot, (d) => ({ expenses: prepend(entries, d.expenses) }));
    },
    // The key is kept: a retry of a save that did go through replays it.
    onError: (err) => refetchAfterServerError(queryClient, lotId, err),
  });
}

export interface IDeleteEntryInput {
  kind: EntryKind;
  id: number;
}

function without(detail: ILotDetail, { kind, id }: IDeleteEntryInput): Partial<ILotDetail> {
  if (kind === 'sale') return { sales: detail.sales.filter((e) => e.id !== id) };
  if (kind === 'spoilage') return { spoilage: detail.spoilage.filter((e) => e.id !== id) };
  return { expenses: detail.expenses.filter((e) => e.id !== id) };
}

/**
 * DELETE …/{sales|spoilage|expenses}/{id}/ → `{lot}`. The key is scoped to the URL on the
 * server, so deleting several entries at once (undo of an expenses batch) is safe.
 */
export function useDeleteEntry(lotId: number): UseMutationResult<ILotWrite, unknown, IDeleteEntryInput> {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async ({ kind, id }: IDeleteEntryInput) => (
      await api.delete<ILotWrite>(`${lotUrl(lotId)}${SEGMENT[kind]}/${id}/`, {
        headers: { [IDEMPOTENCY_HEADER]: idem.key },
      })
    ).data,
    onSuccess: ({ lot }, input) => {
      idem.reset();
      applyLot(queryClient, lot, (d) => without(d, input));
    },
  });
}
