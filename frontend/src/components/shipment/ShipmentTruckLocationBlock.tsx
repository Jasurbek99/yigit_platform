import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Alert, Button, Empty, Select, Space, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import 'leaflet/dist/leaflet.css';
import { useShipmentTruckPosition, useSetShipmentDevice } from '@/hooks/useShipmentTruckPosition';
import { useTransportDevices } from '@/hooks/useTransportDevices';
import { pinIcon, truckState } from '@/utils/truckPin';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

// react-leaflet v4 reads MapContainer's `center` only at mount, and Leaflet
// measures its container at mount too. Inside a modal that container is still
// being laid out by the portal, so without invalidateSize the map paints as a
// grey 0×0 box; on a page it also keeps the viewport following the truck across
// the 30s poll drift. Both fixes belong to the same child so they share the ref.
function FitToTruck({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

interface IProps {
  shipmentId: number;
  /** Whether the shipment names a truck at all — `truck_plate || truck_head_id`.
   *  Passed in rather than read here so the block works with any shipment shape
   *  (the Sheet row and the Detail payload are different types). */
  hasTruck: boolean;
  /** Show the manual device picker + "reset to auto". Off on the Sheet: linking
   *  a device is an edit decision that screen deliberately does not make. */
  canEdit: boolean;
  mapHeight?: number;
}

/**
 * A shipment's truck on a map: last GPS fix, address, speed and how the device
 * was resolved — plus, for editors, the manual device override.
 *
 * One block, two wrappers: `ShipmentTruckLocationCard` (a Card on Shipment
 * Detail) and `ShipmentTruckMapModal` (a Modal behind the Sheet's R15 pin).
 * Keeping the body here is what stops the two screens drifting apart — they
 * showed the same truck with different artwork and different empty states
 * until 2026-09-07.
 *
 * `useShipmentTruckPosition` polls every 30s, so mount this only where a map is
 * actually wanted — the Sheet's modal is conditionally rendered for exactly
 * that reason.
 */
export function ShipmentTruckLocationBlock({
  shipmentId,
  hasTruck,
  canEdit,
  mapHeight = 320,
}: IProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useShipmentTruckPosition(shipmentId);
  const { set, clear } = useSetShipmentDevice(shipmentId);
  const [picking, setPicking] = useState(false);
  // Only editors ever see the picker, so only they should pay for its fetch.
  const devicesQuery = useTransportDevices({ enabled: canEdit });

  const deviceOptions = useMemo(
    () =>
      (devicesQuery.data ?? []).map((d) => ({
        value: d.traccar_id,
        label: `${d.plate ?? d.name} ${d.fleet_no ?? ''}`.trim(),
      })),
    [devicesQuery.data],
  );

  if (isLoading) return <Spin />;
  if (isError) return <Alert type="error" message={t('fleet_map.load_error')} />;

  const device = data?.device ?? null;
  const pos = data?.position ?? null;

  const picker = canEdit && (picking || device !== null) && (
    <Space style={{ marginTop: 8 }} wrap>
      <Select
        showSearch
        placeholder={t('fleet_map.pick_device')}
        style={{ minWidth: 220 }}
        options={deviceOptions}
        optionFilterProp="label"
        loading={devicesQuery.isLoading}
        onChange={(v) =>
          set.mutate(v as number, {
            onSuccess: () => setPicking(false),
            onError: () => toast.error(t('fleet_map.load_error')),
          })
        }
      />
      {data?.resolved_by === 'manual' && (
        <Button
          onClick={() => clear.mutate(undefined, { onError: () => toast.error(t('fleet_map.load_error')) })}
        >
          {t('fleet_map.reset_auto')}
        </Button>
      )}
    </Space>
  );

  // Resolved data first, heuristics last. `hasTruck` reads two shipment columns;
  // the resolver's first step is a manual ShipmentDeviceLink, which is
  // independent of both — an editor can link a device by hand for a shipment
  // whose plate was never typed (stale/mistyped plates are the documented
  // reason that override exists). Checking `hasTruck` first would answer
  // "set the truck" over a live position. So `hasTruck` only ever picks
  // between two already-dead ends.
  if (!pos) {
    const message = device
      ? t('fleet_map.no_position')
      : hasTruck
        ? t('fleet_map.shipment_no_gps')
        : t('fleet_map.sheet_set_truck');
    return (
      <Empty description={message}>
        {canEdit && !picking && (
          <Button onClick={() => setPicking(true)}>{t('fleet_map.link_device')}</Button>
        )}
        {picker}
      </Empty>
    );
  }

  return (
    <>
      <div style={{ height: mapHeight, marginBottom: 8 }}>
        <MapContainer center={[pos.lat, pos.lon]} zoom={8} style={{ height: '100%' }}>
          <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" />
          <FitToTruck lat={pos.lat} lon={pos.lon} />
          {/* Same artwork and same legend as the Fleet Map (blue = rolling,
              green = parked, red = stale/offline) — one truck must not read
              as two different things on two screens. */}
          <Marker position={[pos.lat, pos.lon]} icon={pinIcon(truckState(pos), true)}>
            <Popup>
              {device?.plate} {device?.fleet_no}
              <br />
              {pos.address ?? '—'}
            </Popup>
          </Marker>
        </MapContainer>
      </div>
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space size={6}>
          <Typography.Text strong>
            {device?.plate ?? '—'} {device?.fleet_no ?? ''}
          </Typography.Text>
          {data?.resolved_by && data.resolved_by !== 'none' && (
            <Tag color={data.resolved_by === 'manual' ? 'blue' : 'default'}>
              {t(`fleet_map.resolved_${data.resolved_by}`)}
            </Tag>
          )}
        </Space>
        <Typography.Text type="secondary">{pos.address ?? '—'}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {pos.speed ?? 0} km/h · {pos.is_online ? t('fleet_map.online') : t('fleet_map.offline')}
          {pos.is_stale ? ` · ${t('fleet_map.stale')}` : ''}
          {pos.fix_time ? ` · ${t('fleet_map.last_fix')}: ${new Date(pos.fix_time).toLocaleString()}` : ''}
        </Typography.Text>
      </Space>
      {picker}
    </>
  );
}
