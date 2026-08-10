import { useMemo } from 'react';
import { Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDetail } from '@/types';
import { useTruckHeads, useTrailers } from '@/hooks/useFleet';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';

/**
 * Truck-head / trailer selector for the ShipmentDetail transport card.
 * Replaces the free-text `truck_plate` field for non-Gapy-Satys shipments —
 * derives `truck_plate` from the selected fleet plates so downstream
 * consumers (GPS card, sheet, PDFs) keep reading the same combined string.
 * Gapy-Satys shipments have no fleet linkage, so they keep the plain text
 * field instead (see ShipmentTransportBody).
 */
export function ShipmentTruckSelector({
  shipment,
  readOnly,
}: {
  shipment: IShipmentDetail;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { data: heads } = useTruckHeads();
  const { data: trailers } = useTrailers();
  const { mutate } = useShipmentPatchMulti();

  const headOpts = useMemo(
    () => (heads ?? []).map((h) => ({ value: h.id, label: h.plate_number })),
    [heads],
  );
  const trailerOpts = useMemo(
    () => (trailers ?? []).map((r) => ({ value: r.id, label: r.plate_number })),
    [trailers],
  );

  function plateFor(headId: number | null, trailerId: number | null): string {
    const head = heads?.find((h) => h.id === headId)?.plate_number ?? '';
    const trailer = trailers?.find((r) => r.id === trailerId)?.plate_number ?? '';
    return [head, trailer].filter(Boolean).join('/');
  }

  function save(headId: number | null, trailerId: number | null) {
    mutate({
      id: shipment.id,
      fields: {
        truck_head_id: headId,
        trailer_id: trailerId,
        truck_plate: plateFor(headId, trailerId),
      },
    });
  }

  const headId = (shipment.truck_head_id as number | null) ?? null;
  const trailerId = (shipment.trailer_id as number | null) ?? null;

  // Default values feed react-i18next's no-instance fallback (used by tests
  // that render this component without an i18n provider) — with a real
  // instance loaded, the key's actual translation always wins.
  const headLabel = t('shipment_edit_drawer.field.truck_head', 'Truck head');
  const trailerLabel = t('shipment_edit_drawer.field.trailer', 'Trailer');

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {headLabel}
        </Typography.Text>
        <Select
          aria-label={headLabel}
          showSearch
          allowClear
          disabled={readOnly}
          style={{ width: '100%' }}
          value={headId ?? undefined}
          options={headOpts}
          optionFilterProp="label"
          onChange={(v) => save((v as number) ?? null, trailerId)}
          placeholder={headLabel}
        />
      </div>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {trailerLabel}
        </Typography.Text>
        <Select
          aria-label={trailerLabel}
          showSearch
          allowClear
          disabled={readOnly}
          style={{ width: '100%' }}
          value={trailerId ?? undefined}
          options={trailerOpts}
          optionFilterProp="label"
          onChange={(v) => save(headId, (v as number) ?? null)}
          placeholder={trailerLabel}
        />
      </div>
    </Space>
  );
}
