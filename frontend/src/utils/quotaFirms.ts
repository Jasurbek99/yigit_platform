/**
 * Shared read of the per-firm quota balance map served by
 * `GET /export/quota-firm-balances/` (`useQuotaFirmBalances`).
 *
 * Two pickers gate on it — the Sheet's R9 `firm_splits` cell and
 * `ExportFirmSelect` in the destination-draft modal — and both must agree with
 * the server, which blocks the same firms in `POST /shipments/{id}/firm-splits/`
 * and on draft creation.
 */
import type { IFirmQuotaBalance } from '@/hooks/useQuotaDashboard';

/**
 * Whether this firm may NOT be added to a split: no allocation at all (absent
 * from the map) or nothing left of it.
 *
 * Returns false while `balances` is undefined — the query is still in flight
 * and the dropdowns open immediately, so reporting "blocked" there would flash
 * a ⚠ tag on every firm before the first response lands.
 */
export function firmHasNoQuota(
  balances: Record<string, IFirmQuotaBalance> | undefined,
  firmId: number,
): boolean {
  if (!balances) return false;
  const bal = balances[String(firmId)];
  return !bal || Number(bal.remaining_kg) <= 0;
}
