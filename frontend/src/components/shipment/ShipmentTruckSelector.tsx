import { useMemo, useState } from 'react';
import { Select, Space, Typography, Button, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { IShipmentDetail } from '@/types';
import { useTruckHeads, useTrailers, useCreateTruckHead, useCreateTrailer } from '@/hooks/useFleet';
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
  const [headSearch, setHeadSearch] = useState('');
  const [trailerSearch, setTrailerSearch] = useState('');
  const createHead = useCreateTruckHead();
  const createTrailer = useCreateTrailer();

  const headOpts = useMemo(
    () => (heads ?? []).map((h) => ({ value: h.id, label: h.plate_number })),
    [heads],
  );
  const trailerOpts = useMemo(
    () => (trailers ?? []).map((r) => ({ value: r.id, label: r.plate_number })),
    [trailers],
  );

  // `knownPlates` lets a caller supply the plate string directly for a fleet
  // item that was JUST created — it can't be found via `heads`/`trailers`
  // yet because the create mutation's list invalidation refetch is async
  // and hasn't landed by the time we compose `truck_plate` for this save.
  function plateFor(
    headId: number | null,
    trailerId: number | null,
    knownPlates?: { head?: string; trailer?: string },
  ): string {
    const head = knownPlates?.head ?? heads?.find((h) => h.id === headId)?.plate_number ?? '';
    const trailer =
      knownPlates?.trailer ?? trailers?.find((r) => r.id === trailerId)?.plate_number ?? '';
    return [head, trailer].filter(Boolean).join('/');
  }

  function save(
    headId: number | null,
    trailerId: number | null,
    knownPlates?: { head?: string; trailer?: string },
  ) {
    mutate({
      id: shipment.id,
      fields: {
        truck_head_id: headId,
        trailer_id: trailerId,
        truck_plate: plateFor(headId, trailerId, knownPlates),
      },
    });
  }

  const headId = (shipment.truck_head_id as number | null) ?? null;
  const trailerId = (shipment.trailer_id as number | null) ?? null;

  const headLabel = t('shipment_edit_drawer.field.truck_head');
  const trailerLabel = t('shipment_edit_drawer.field.trailer');

  const norm = (s: string) => s.trim().toUpperCase();
  const headExists = (heads ?? []).some((h) => norm(h.plate_number) === norm(headSearch));
  const trailerExists = (trailers ?? []).some((r) => norm(r.plate_number) === norm(trailerSearch));

  async function addHead() {
    const plate = headSearch.trim();
    if (!plate) return;
    const created = await createHead.mutateAsync(plate);
    setHeadSearch('');
    // link the new truck to the shipment; pass its plate directly since
    // `heads` won't include it until the list refetch lands (see plateFor)
    save(created.id, trailerId, { head: created.plate_number });
  }
  async function addTrailer() {
    const plate = trailerSearch.trim();
    if (!plate) return;
    const created = await createTrailer.mutateAsync(plate);
    setTrailerSearch('');
    save(headId, created.id, { trailer: created.plate_number });
  }

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
          onSearch={setHeadSearch}
          placeholder={headLabel}
          dropdownRender={(menu) => (
            <>
              {menu}
              {headSearch.trim() && !headExists && (
                <>
                  <Divider style={{ margin: '4px 0' }} />
                  <Button
                    type="text"
                    icon={<PlusOutlined />}
                    loading={createHead.isPending}
                    style={{ width: '100%', textAlign: 'left' }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={addHead}
                  >
                    {t('shipment_edit_drawer.add_truck', { plate: headSearch.trim() })}
                  </Button>
                </>
              )}
            </>
          )}
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
          onSearch={setTrailerSearch}
          placeholder={trailerLabel}
          dropdownRender={(menu) => (
            <>
              {menu}
              {trailerSearch.trim() && !trailerExists && (
                <>
                  <Divider style={{ margin: '4px 0' }} />
                  <Button
                    type="text"
                    icon={<PlusOutlined />}
                    loading={createTrailer.isPending}
                    style={{ width: '100%', textAlign: 'left' }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={addTrailer}
                  >
                    {t('shipment_edit_drawer.add_trailer', { plate: trailerSearch.trim() })}
                  </Button>
                </>
              )}
            </>
          )}
        />
      </div>
    </Space>
  );
}
