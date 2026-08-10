import type { IQuotaUsageRecord } from '@/types';

/** One expandable row: a truck (or the manual bucket) with its per-firm records. */
export interface IUsageGroup {
  /** Table rowKey — `s:<shipmentId>`, or `manual` for the unlinked bucket. */
  key: string;
  shipmentId: number | null;
  shipmentCode: string | null;
  /** Earliest usage_date in the group — what the row shows and sorts on. */
  date: string;
  records: IQuotaUsageRecord[];
  totalKg: number;
  firmCount: number;
}

/** Key for the bucket holding every record with no shipment behind it. */
export const MANUAL_GROUP_KEY = 'manual';

function kg(record: IQuotaUsageRecord): number {
  const value = Number(record.kg_used);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Group usage records by the truck that spent the quota.
 *
 * Replaces the date × firm matrix: quota is spent per truck, so the truck is the
 * unit an operator reconciles against, and a firm's share only means anything
 * next to the other firms on the same truck.
 *
 * Records with no shipment — historical Excel imports and hand-entered rows,
 * 575 of 711 on the dev database — collapse into ONE bucket keyed
 * `MANUAL_GROUP_KEY` rather than being dropped. Hiding 80% of the table by
 * default would be worse than the matrix this replaces.
 *
 * Ordering: newest date first, with the manual bucket pinned last regardless of
 * its dates — it is a catch-all, not an event.
 */
export function groupRecordsByShipment(
  records: readonly IQuotaUsageRecord[],
): IUsageGroup[] {
  const groups = new Map<string, IUsageGroup>();

  for (const record of records) {
    const key = record.shipment == null ? MANUAL_GROUP_KEY : `s:${record.shipment}`;
    const existing = groups.get(key);
    if (existing) {
      existing.records.push(record);
      existing.totalKg += kg(record);
      if (record.usage_date < existing.date) existing.date = record.usage_date;
    } else {
      groups.set(key, {
        key,
        shipmentId: record.shipment,
        shipmentCode: record.shipment_code,
        date: record.usage_date,
        records: [record],
        totalKg: kg(record),
        firmCount: 0,
      });
    }
  }

  const list = Array.from(groups.values());
  for (const group of list) {
    group.firmCount = new Set(group.records.map((r) => r.export_firm)).size;
    group.records.sort((a, b) => a.export_firm_name.localeCompare(b.export_firm_name));
  }

  return list.sort((a, b) => {
    if (a.key === MANUAL_GROUP_KEY) return 1;
    if (b.key === MANUAL_GROUP_KEY) return -1;
    return b.date.localeCompare(a.date);
  });
}

/** Total kg across every group — the figure under the table. */
export function totalKg(groups: readonly IUsageGroup[]): number {
  return groups.reduce((sum, group) => sum + group.totalKg, 0);
}
