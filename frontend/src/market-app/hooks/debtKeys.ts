import type { QueryClient } from '@tanstack/react-query';
import { LOTS_KEY } from './lotKeys';

export const DEBTS_KEY: readonly string[] = ['market', 'debts'];
/** Prefix of every lot detail (`lotKey(id)`); not the lots lists, which are `['market', 'lots']`. */
const LOT_DETAILS_KEY: readonly string[] = ['market', 'lot'];

/**
 * After a payment is recorded or undone: refetch the debts, the lots lists and every lot detail.
 * An undo reopens sales already paid off, which are no longer in the debts list, so the
 * affected lots cannot be known here — all details are marked stale (only open ones refetch).
 */
export function refetchAfterPayment(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: DEBTS_KEY });
  void queryClient.invalidateQueries({ queryKey: LOTS_KEY });
  void queryClient.invalidateQueries({ queryKey: LOT_DETAILS_KEY });
}
