import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Input, List, Badge, Spin, Alert, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import { useLivePositions, type ILivePosition } from '@/hooks/useLivePositions';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// Turkmenistan-centred default view (Ashgabat area), matching the Traccar server.
const DEFAULT_CENTER: [number, number] = [37.95, 58.39];
const DEFAULT_ZOOM = 5;

function pinColor(p: ILivePosition): string {
  if (p.is_stale) return '#9ca3af'; // grey
  if (p.is_online) return '#16a34a'; // green
  return '#f59e0b'; // amber (known but offline)
}

export default function FleetMap() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useLivePositions();
  const [search, setSearch] = useState('');

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

  if (isLoading) return <Spin style={{ margin: 48 }} />;
  if (isError) return <Alert type="error" message={t('fleet_map.load_error')} />;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 12 }}>
      <div style={{ width: 320, overflowY: 'auto' }}>
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
            <List.Item>
              <div>
                <Badge color={pinColor(p)} />{' '}
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
          {rows.map((p) => (
            <CircleMarker
              key={p.device_id}
              center={[p.lat, p.lon]}
              radius={7}
              pathOptions={{ color: pinColor(p), fillColor: pinColor(p), fillOpacity: 0.9 }}
            >
              <Popup>
                <strong>{p.plate}</strong> {p.fleet_no}
                <br />
                {p.address ?? '—'}
                <br />
                {p.speed ?? 0} km/h · {p.is_online ? 'online' : 'offline'}
                {p.is_stale ? ' · stale' : ''}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
