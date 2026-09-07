import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Modal, Alert, Empty, Space, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import type { IShipmentSheetItem } from '@/types';
import { useShipmentTruckPosition } from '@/hooks/useShipmentTruckPosition';
import { pinIcon, truckState } from '@/utils/truckPin';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const MAP_HEIGHT = 380;

// react-leaflet v4 reads MapContainer's `center` only at mount, and Leaflet
// measures its container at mount too. Inside a modal that container is still
// being laid out by the portal, so without invalidateSize the map paints as a
// grey 0×0 box. Both fixes belong to the same child so they share the map ref.
function FitToTruck({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

/**
 * Read-only GPS position of a shipment's truck, opened from the Sheet's
 * "Vehicle Current Position / ETA" cell.
 *
 * Mount it only while the map is open — `useShipmentTruckPosition` polls every
 * 30s, and the Sheet renders hundreds of cells at once. The parent conditionally
 * renders this component so closing it unmounts the poll.
 *
 * Deliberately NOT `ShipmentTruckLocationCard`: that card also owns the manual
 * device picker, which needs an edit-permission decision the Sheet shouldn't
 * make. Linking a device stays on the Shipment Detail page.
 */
export function ShipmentTruckMapModal({
  shipment,
  onClose,
}: {
  shipment: IShipmentSheetItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useShipmentTruckPosition(shipment.id);

  const device = data?.device ?? null;
  const pos = data?.position ?? null;
  // A truck can be named either by an explicit fleet selection or by a typed
  // plate; the backend resolver accepts both, so "no truck" means neither.
  const hasTruck = Boolean(shipment.truck_plate || shipment.truck_head_id);

  return (
    <Modal
      open
      destroyOnHidden
      footer={null}
      width={720}
      onCancel={onClose}
      title={
        <Space>
          {t('fleet_map.shipment_card_title')}
          <Typography.Text type="secondary">{shipment.shipment_code}</Typography.Text>
          {data?.resolved_by && data.resolved_by !== 'none' && (
            <Tag color={data.resolved_by === 'manual' ? 'blue' : 'default'}>
              {t(`fleet_map.resolved_${data.resolved_by}`)}
            </Tag>
          )}
        </Space>
      }
    >
      {renderBody()}
    </Modal>
  );

  function renderBody() {
    if (isLoading) return <Spin />;
    if (isError) return <Alert type="error" message={t('fleet_map.load_error')} />;

    // Resolved data first, heuristics last. `hasTruck` reads two Sheet columns;
    // the resolver's first step is a manual ShipmentDeviceLink, which is
    // independent of both — an editor can link a device by hand for a shipment
    // whose plate was never typed (stale/mistyped plates are the documented
    // reason that override exists). Checking `hasTruck` first would answer
    // "set the truck" over a live position. So `hasTruck` only ever picks
    // between two already-dead ends.
    if (!pos) {
      if (device) return <Empty description={t('fleet_map.no_position')} />;
      if (!hasTruck) return <Empty description={t('fleet_map.sheet_set_truck')} />;
      return <Empty description={t('fleet_map.shipment_no_gps')} />;
    }

    return (
      <>
        <div style={{ height: MAP_HEIGHT, marginBottom: 8 }}>
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
          <Typography.Text strong>
            {device?.plate ?? '—'} {device?.fleet_no ?? ''}
          </Typography.Text>
          <Typography.Text type="secondary">{pos.address ?? '—'}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {pos.speed ?? 0} km/h · {pos.is_online ? t('fleet_map.online') : t('fleet_map.offline')}
            {pos.is_stale ? ` · ${t('fleet_map.stale')}` : ''}
            {pos.fix_time ? ` · ${t('fleet_map.last_fix')}: ${new Date(pos.fix_time).toLocaleString()}` : ''}
          </Typography.Text>
        </Space>
      </>
    );
  }
}
