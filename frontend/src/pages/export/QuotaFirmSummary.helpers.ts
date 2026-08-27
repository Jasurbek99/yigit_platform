/**
 * Pure helpers for the quota dashboard's Firm Quota tab.
 *
 * Kept out of the component so the expiry thresholds and the footer arithmetic
 * are testable without rendering antd.
 */
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import type { IQuotaFirmSummaryRow } from '@/hooks/useQuotaDashboard';

export type FirmQuotaExpiryStatus = 'active' | 'expiring' | 'expired';

export interface IFirmQuotaExpiry {
  status: FirmQuotaExpiryStatus;
  daysLeft: number;
}

/**
 * How urgent a firm's nearest quota expiry is.
 *
 * Thresholds are copied verbatim from `QuotaIssuancesList.tsx` (`< 0` expired,
 * `<= 7` expiring) so the two tabs flag the same rows on the same day.
 *
 * The `expired` branch is not reachable through the real pipeline — the backend
 * only ever reports the expiry of an allocation it still considers live — but
 * it is kept for clock skew between the server's `today` and the browser's.
 *
 * Returns null when the firm holds no live quota at all, which the caller
 * renders as "no live quota" rather than as a date.
 */
export function expiryStatus(
  nearestExpiry: string | null,
  today: Dayjs,
): IFirmQuotaExpiry | null {
  if (!nearestExpiry) return null;
  const daysLeft = dayjs(nearestExpiry).diff(today, 'day');
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft <= 7) return { status: 'expiring', daysLeft };
  return { status: 'active', daysLeft };
}

export interface IFirmQuotaTotals {
  active_issuance_count: number;
  issued_kg: number;
  used_kg: number;
  remaining_kg: number;
}

/**
 * Footer totals, summed over the rows actually RENDERED — never over a separate
 * fetch, so the footer always reconciles with what the reader can count.
 */
export function buildFirmQuotaTotals(rows: IQuotaFirmSummaryRow[]): IFirmQuotaTotals {
  return {
    active_issuance_count: rows.reduce((s, r) => s + r.active_issuance_count, 0),
    issued_kg: rows.reduce((s, r) => s + r.issued_kg, 0),
    used_kg: rows.reduce((s, r) => s + r.used_kg, 0),
    remaining_kg: rows.reduce((s, r) => s + r.remaining_kg, 0),
  };
}

/**
 * Remaining kg descending, ties broken on firm name — the same order the
 * backend already returns, applied client-side so a user who sorts by another
 * column and back lands on the original order.
 */
export function sortFirmQuotaRows(rows: IQuotaFirmSummaryRow[]): IQuotaFirmSummaryRow[] {
  return [...rows].sort(
    (a, b) =>
      b.remaining_kg - a.remaining_kg ||
      a.export_firm_name.localeCompare(b.export_firm_name),
  );
}
