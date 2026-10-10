import type { QueryClient } from '@tanstack/react-query';
import { httpStatus } from '@/utils/drfErrors';
import type { ILot, ILotDetail, LotState } from '../types';

/** Every lots list (open / closed); a write invalidates them all. */
export const LOTS_KEY: readonly string[] = ['market', 'lots'];
export const SHIPMENTS_KEY: readonly string[] = ['market', 'shipments'];
export const BUYERS_KEY: readonly string[] = ['market', 'buyers'];

export function lotsKey(state: LotState): readonly string[] {
  return [...LOTS_KEY, state];
}

/** The lot detail. Always a number id — `'7'` and `7` would be two cache entries. */
export function lotKey(id: number): readonly (string | number)[] {
  return ['market', 'lot', id];
}

/**
 * Write a lot returned by a mutation into the cached detail (keeping its entry lists,
 * which the write answers do not carry), apply `edit` to those lists, refetch the lists.
 */
export function applyLot(
  queryClient: QueryClient,
  lot: ILot,
  edit?: (detail: ILotDetail) => Partial<ILotDetail>,
): void {
  queryClient.setQueryData<ILotDetail>(lotKey(lot.id), (old) => (old ? { ...old, ...lot, ...edit?.(old) } : old));
  void queryClient.invalidateQueries({ queryKey: LOTS_KEY });
}

/** A create answered 5xx may still have been saved: refetch the lot detail so the list shows it. */
export function refetchAfterServerError(queryClient: QueryClient, lotId: number, err: unknown): void {
  if ((httpStatus(err) ?? 0) >= 500) void queryClient.invalidateQueries({ queryKey: lotKey(lotId) });
}
