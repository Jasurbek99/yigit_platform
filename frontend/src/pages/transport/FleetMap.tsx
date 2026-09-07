import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Input, List, Badge, Spin, Alert, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'leaflet/dist/leaflet.css';
import { useLivePositions, type ILivePosition } from '@/hooks/useLivePositions';
import { pinIcon, truckState, STATE_COLOR } from '@/utils/truckPin';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// Turkmenistan-centred default view (Ashgabat area), matching the Traccar server.
const DEFAULT_CENTER: [number, number] = [37.95, 58.39];
const DEFAULT_ZOOM = 5;
// Dispatchers read the sync stamp to decide whether the pins are trustworthy, so
// it must render in Ashgabat time regardless of the workstation clock — the same
// reason SelfBoard pins its day boundary (KZ/RU-joined machines often run UTC).
dayjs.extend(utc);
dayjs.extend(timezone);
const TM_TZ = 'Asia/Ashgabat';
const STAMP_FORMAT = 'DD.MM.YYYY HH:mm';
// Zoom to fly to when a truck is picked from the sidebar — close enough to read
// the road it is on, but never zooming OUT if the operator is already closer in.
const SELECTED_ZOOM = 12;
/** Flies the map to the picked truck. Must render inside <MapContainer> — that
 *  is the only place react-leaflet exposes the Leaflet map instance. */
function FlyToSelected({ target }: { target: ILivePosition | null }) {
  const map = useMap();
  const deviceId = target?.device_id ?? null;
  const lat = target?.lat;
  const lon = target?.lon;

  useEffect(() => {
    if (deviceId === null || lat === undefined || lon === undefined) return;
    map.flyTo([lat, lon], Math.max(map.getZoom(), SELECTED_ZOOM));
    // Keyed on the device id, NOT the coords: the 30s refetch produces a new
    // position object every tick, and re-flying then would yank the map back
    // whenever the operator had panned away from a still-selected truck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, deviceId]);

  return null;
}

export default function FleetMap() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useLivePositions();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Newest write across ALL rows, not the filtered `rows` — the stamp describes
  // the poller, not the search box. Devices Traccar stopped reporting keep their
  // old `updated_at`, so the max is the last poll that wrote anything; it goes
  // stale on its own once the poller dies.
  const lastSync = useMemo(() => {
    let newest: Dayjs | null = null;
    for (const p of data ?? []) {
      if (!p.updated_at) continue;
      const stamp = dayjs(p.updated_at);
      if (!stamp.isValid()) continue;
      if (newest === null || stamp.isAfter(newest)) newest = stamp;
    }
    return newest;
  }, [data]);

  const rows = useMemo(() => {
    const items = data ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (p) =>
        (p.plate ?? '').toLowerCase().includes(q) ||
        (p.fleet_no ?? '').toLowerCase().includes(q) ||
        (p.address ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  // Resolved against the unfiltered `data`: typing in the search box must not
  // drop the selection out from under the map.
  const selected = useMemo(
    () => (data ?? []).find((p) => p.device_id === selectedId) ?? null,
    [data, selectedId],
  );

  if (isLoading) return <Spin style={{ margin: 48 }} />;
  if (isError) return <Alert type="error" message={t('fleet_map.load_error')} />;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 12 }}>
      <div style={{ width: 320, overflowY: 'auto' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          {t('fleet_map.last_sync')}:{' '}
          {lastSync ? lastSync.tz(TM_TZ).format(STAMP_FORMAT) : t('fleet_map.never')}
        </Typography.Text>
        <Input.Search
          placeholder={t('fleet_map.search_placeholder')}
          allowClear
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <List
          size="small"
          dataSource={rows}
          renderItem={(p) => (
            <List.Item
              onClick={() => setSelectedId(p.device_id === selectedId ? null : p.device_id)}
              style={{
                cursor: 'pointer',
                background: p.device_id === selectedId ? '#e6f4ff' : undefined,
              }}
            >
              <div>
                <Badge color={STATE_COLOR[truckState(p)]} />{' '}
                <Typography.Text strong>{p.plate ?? p.fleet_no ?? p.device_id}</Typography.Text>{' '}
                <Typography.Text type="secondary">{p.fleet_no}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {p.address ?? '—'}
                  </Typography.Text>
                </div>
              </div>
            </List.Item>
          )}
        />
      </div>
      <div style={{ flex: 1 }}>
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: '100%' }}>
          <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" />
          <FlyToSelected target={selected} />
          {rows.map((p) => (
            <Marker
              key={p.device_id}
              position={[p.lat, p.lon]}
              // Selection reads as size, not colour — colour is spoken for by
              // the state, and a picked truck must still show what it is doing.
              icon={pinIcon(truckState(p), p.device_id === selectedId)}
              zIndexOffset={p.device_id === selectedId ? 1000 : 0}
              eventHandlers={{ click: () => setSelectedId(p.device_id) }}
            >
              <Popup>
                <strong>{p.plate}</strong> {p.fleet_no}
                <br />
                {p.address ?? '—'}
                <br />
                {p.speed ?? 0} km/h · {p.is_online ? 'online' : 'offline'}
                {p.is_stale ? ' · stale' : ''}
                <br />
                {t('fleet_map.last_fix')}:{' '}
                {p.fix_time ? dayjs(p.fix_time).tz(TM_TZ).format(STAMP_FORMAT) : '—'}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
