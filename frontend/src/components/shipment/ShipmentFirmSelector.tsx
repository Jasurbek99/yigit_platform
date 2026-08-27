import { useEffect, useState } from 'react';
import { Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAdminFirms } from '@/hooks/useAdmin';
import { useQuotaFirmBalances } from '@/hooks/useQuotaDashboard';
import { useSetFirmSplits } from '@/hooks/useSetFirmSplits';
import type { IShipmentDetail } from '@/types';

interface IShipmentFirmSelectorProps {
  shipment: IShipmentDetail;
  readOnly: boolean;
}

function firmLabel(f: { code: string; name_tk: string; name_en: string | null }): string {
  return `${f.code} — ${f.name_en ?? f.name_tk}`;
}

/**
 * Compare the current firm-split ids to the picked ones (order-insensitive).
 * Returns the ids to save, or `null` when nothing changed so the caller can
 * skip a pointless POST + audit row (same no-op guard the Sheet applies).
 */
export function firmCommitPayload(current: number[], next: number[]): number[] | null {
  const same = next.length === current.length && next.every((id) => current.includes(id));
  return same ? null : next;
}

/**
 * Export-firm picker for the ShipmentDetail "Destination & Plan" card, replacing
 * the old read-only `export_firms_display` row. Mirrors ShipmentDriverSelector:
 * a self-contained control that writes through a dedicated endpoint
 * (`useSetFirmSplits`) rather than the generic field PATCH — firm_splits is a
 * junction table, not a scalar field. Picks firms only; the backend derives the
 * official per-firm weight and blocks no-quota firms.
 */
export function ShipmentFirmSelector({ shipment, readOnly }: IShipmentFirmSelectorProps) {
  const { t } = useTranslation();
  const { data: firms } = useAdminFirms();
  const { data: balances } = useQuotaFirmBalances('tomato', { enabled: !readOnly });
  const { mutate, isPending } = useSetFirmSplits(shipment.id);

  const currentIds = shipment.firm_splits.map((s) => s.export_firm_id);
  const [value, setValue] = useState<number[]>(currentIds);

  // Re-sync to the server's set whenever it changes (e.g. after a save refetch).
  // Keyed on the sorted id string so an unrelated re-render never clobbers an
  // in-progress edit — the dropdown is closed (thus already committed) by then.
  const currentKey = [...currentIds].sort((a, b) => a - b).join(',');
  useEffect(() => {
    setValue(currentIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const label = t('shipments.export_firms');

  if (readOnly) {
    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{label}</Typography.Text>
        <div>{shipment.export_firms_display ?? '—'}</div>
      </Space>
    );
  }

  const options = (firms ?? [])
    .filter((f) => f.is_active)
    .map((f) => {
      // A firm with no remaining quota can't be newly added (backend 400s it) —
      // flag it ⚠, but a firm already on the split stays selectable.
      const noQuota =
        balances != null &&
        !currentIds.includes(f.id) &&
        (balances[String(f.id)]?.remaining_kg ?? 0) <= 0;
      return { value: f.id, label: noQuota ? `⚠ ${firmLabel(f)}` : firmLabel(f) };
    });

  function commit() {
    const payload = firmCommitPayload(currentIds, value);
    if (payload) mutate(payload);
  }

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{label}</Typography.Text>
      <Select
        mode="multiple"
        aria-label={label}
        value={value}
        options={options}
        onChange={setValue}
        onBlur={commit}
        onOpenChange={(open) => { if (!open) commit(); }}
        loading={isPending}
        style={{ width: '100%' }}
        placeholder={label}
      />
    </Space>
  );
}
