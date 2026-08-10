import type { IQuotaUsageRecord } from '@/types';

/** Lookup key for one grid cell — one date × one firm. */
export function cellKey(date: string, firmId: number): string {
  return `${date}_${firmId}`;
}

/**
 * Group usage records into grid cells.
 *
 * One (date, firm) pair holds MANY records: a firm can ride several trucks in a
 * single day, and each one produces its own `QuotaUsageRecord`. The grid used a
 * `Map<key, record>` here, so the last record read won and every other row in
 * the cell vanished — under-reporting the firm column, the row total and the
 * grand total. The backend never deduped (`services_quota` sums `kg_used` over
 * `counted()`), so this grid was the only screen in the system disagreeing with
 * the ledger. 37 cells on the 2025-2026 season are affected, the worst holding
 * 8 records.
 */
export function groupRecordsByCell(
  records: readonly IQuotaUsageRecord[],
): Map<string, IQuotaUsageRecord[]> {
  const map = new Map<string, IQuotaUsageRecord[]>();
  for (const record of records) {
    const key = cellKey(record.usage_date, record.export_firm);
    const bucket = map.get(key);
    if (bucket) bucket.push(record);
    else map.set(key, [record]);
  }
  return map;
}

/** Total kg across a cell's records. Coerces defensively — the API sends decimal strings. */
export function sumKg(records: readonly IQuotaUsageRecord[]): number {
  let total = 0;
  for (const record of records) {
    const value = Number(record.kg_used);
    if (!Number.isNaN(value)) total += value;
  }
  return total;
}

/**
 * Whether a cell's value may be typed straight into the grid.
 *
 * A cell holding several records has no single row to write to — typing into it
 * used to PATCH whichever record the old Map happened to keep. Those cells are
 * read-only and drill down to the per-record list instead.
 *
 * Record `status` is deliberately NOT consulted. It used to gate editing on
 * `draft`, which since the 2026-08-10 removal of the approval step would mean
 * "nothing is ever editable" — every row is born approved.
 */
export function isCellInlineEditable(
  records: readonly IQuotaUsageRecord[],
  canEdit: boolean,
  canCreate: boolean,
): boolean {
  if (records.length === 0) return canCreate;
  if (records.length > 1) return false;
  return canEdit;
}
