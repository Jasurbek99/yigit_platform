import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Card, Select, Button, Space, Tag, Typography, Spin, Empty } from 'antd';
import { useTranslation } from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import { useShipmentTruckPosition, useSetShipmentDevice } from '@/hooks/useShipmentTruckPosition';
import { useTransportDevices } from '@/hooks/useTransportDevices';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export function ShipmentTruckLocationCard({
  shipmentId,
  canEdit,
}: {
  shipmentId: number;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useShipmentTruckPosition(shipmentId);
  const { set, clear } = useSetShipmentDevice(shipmentId);
  const [picking, setPicking] = useState(false);
  const devicesQuery = useTransportDevices();

  const deviceOptions = useMemo(
    () =>
      (devicesQuery.data ?? []).map((d) => ({
        value: d.traccar_id,
        label: `${d.plate ?? d.name} ${d.fleet_no ?? ''}`.trim(),
      })),
    [devicesQuery.data],
  );

  const title = t('fleet_map.shipment_card_title');
  if (isLoading) return <Card title={title}><Spin /></Card>;

  const pos = data?.position ?? null;
  const pinColor = pos?.is_stale ? '#9ca3af' : pos?.is_online ? '#16a34a' : '#f59e0b';

  return (
    <Card
      title={title}
      extra={
        data?.resolved_by && data.resolved_by !== 'none' ? (
          <Tag color={data.resolved_by === 'manual' ? 'blue' : 'default'}>
            {t(`fleet_map.resolved_${data.resolved_by}`)}
          </Tag>
        ) : null
      }
      style={{ marginBottom: 8 }}
    >
      {data?.resolved_by === 'none' && !picking ? (
        <Empty description={t('fleet_map.shipment_no_gps')}>
          {canEdit && <Button onClick={() => setPicking(true)}>{t('fleet_map.link_device')}</Button>}
        </Empty>
      ) : (
        <>
          {pos && (
            <div style={{ height: 220, marginBottom: 8 }}>
              <MapContainer center={[pos.lat, pos.lon]} zoom={9} style={{ height: '100%' }}>
                <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" />
                <CircleMarker
                  center={[pos.lat, pos.lon]}
                  radius={8}
                  pathOptions={{ color: pinColor, fillColor: pinColor, fillOpacity: 0.9 }}
                >
                  <Popup>
                    {data?.device?.plate} {data?.device?.fleet_no}
                    <br />
                    {pos.address ?? '—'}
                  </Popup>
                </CircleMarker>
              </MapContainer>
            </div>
          )}
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Text strong>
              {data?.device?.plate ?? '—'} {data?.device?.fleet_no ?? ''}
            </Typography.Text>
            <Typography.Text type="secondary">{pos?.address ?? t('fleet_map.no_position')}</Typography.Text>
            {pos && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {pos.speed ?? 0} km/h · {pos.is_online ? t('fleet_map.online') : t('fleet_map.offline')}
                {pos.is_stale ? ` · ${t('fleet_map.stale')}` : ''}
              </Typography.Text>
            )}
          </Space>
        </>
      )}

      {canEdit && (picking || data?.resolved_by !== 'none') && (
        <Space style={{ marginTop: 8 }} wrap>
          <Select
            showSearch
            placeholder={t('fleet_map.pick_device')}
            style={{ minWidth: 220 }}
            options={deviceOptions}
            optionFilterProp="label"
            loading={devicesQuery.isLoading}
            onChange={(v) => set.mutate(v as number, { onSuccess: () => setPicking(false) })}
          />
          {data?.resolved_by === 'manual' && (
            <Button onClick={() => clear.mutate()}>{t('fleet_map.reset_auto')}</Button>
          )}
        </Space>
      )}
    </Card>
  );
}
