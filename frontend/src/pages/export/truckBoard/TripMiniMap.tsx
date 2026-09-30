import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { pinIcon } from '@/utils/truckPin';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

interface IPoint {
  lat: number;
  lon: number;
}

// Leaflet measures its container at mount; inside a drawer or a card that is
// still expanding it measures 0×0, so re-measure once mounted (same fix as the
// shipment truck-location block).
function FitToTruck({ lat, lon }: IPoint) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

interface ITripMiniMapProps extends IPoint {
  height: number;
}

/** One truck pin on a small map — the trip card's expanded view and the trip drawer. */
export function TripMiniMap({ lat, lon, height }: ITripMiniMapProps) {
  return (
    <div style={{ height, marginTop: 8 }} data-testid="trip-map">
      <MapContainer center={[lat, lon]} zoom={12} style={{ height: '100%' }} scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} />
        <Marker position={[lat, lon]} icon={pinIcon('idle', true)} />
        <FitToTruck lat={lat} lon={lon} />
      </MapContainer>
    </div>
  );
}
