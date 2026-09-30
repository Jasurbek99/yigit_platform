import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { Button, Descriptions, Drawer } from 'antd';
import { useTranslation } from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';
import { openTripDocument } from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { pinIcon } from '@/utils/truckPin';
import { useTripMessages } from './useTripMessages';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

interface IFitToTruckProps {
  lat: number;
  lon: number;
}

// Leaflet measures its container at mount; inside a drawer that container is
// still animating in, so re-measure once it is there (same fix as the
// shipment truck-location block).
function FitToTruck({ lat, lon }: IFitToTruckProps) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

interface ITripDrawerProps {
  trip: IExternalTrip | null;
  onClose: () => void;
}

export function TripDrawer({ trip, onClose }: ITripDrawerProps) {
  const { t } = useTranslation();
  const messages = useTripMessages();
  const openPdf = (tripId: number) =>
    openTripDocument(tripId).catch(() => toast.error(t('truck_board.error.pdf')));
  const vehicle = (plate: string, brand: string | null, model: string | null, company: string | null) =>
    [plate, [brand, model].filter(Boolean).join(' '), company].filter(Boolean).join(' · ');
  return (
    <Drawer open={trip !== null} onClose={onClose} width={520} destroyOnHidden title={t('truck_board.details')}>
      {trip && (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t('truck_board.trip')}>
              {trip.trip_number ?? t('truck_board.awaiting_code')} · {messages.status(trip.status)}
            </Descriptions.Item>
            <Descriptions.Item label={t('truck_board.planned_departure')}>{trip.planned_departure}</Descriptions.Item>
            <Descriptions.Item label={t('truck_board.country')}>{trip.destination_country_code ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('truck_board.tractor')}>
              {vehicle(trip.tractor_plate, trip.tractor_brand, trip.tractor_model, trip.tractor_company)}
            </Descriptions.Item>
            <Descriptions.Item label={t('truck_board.trailer')}>
              {vehicle(trip.trailer_plate, trip.trailer_brand, trip.trailer_model, trip.trailer_company)}
            </Descriptions.Item>
            <Descriptions.Item label={t('truck_board.driver')}>{trip.driver_full_name}</Descriptions.Item>
            <Descriptions.Item label={t('truck_board.phone')}>{trip.driver_phone ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('truck_board.passport')}>
              {trip.driver_passport_number
                ? `${trip.driver_passport_number} · ${t('truck_board.valid_until')} ${trip.driver_passport_expiry ?? '—'}`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('truck_board.visas')}>
              {trip.visas.length
                ? trip.visas.map((v) => <div key={v.country}>{v.country} — {v.expiry_date}</div>)
                : '—'}
            </Descriptions.Item>
          </Descriptions>
          {trip.position && (
            <div style={{ height: 220, marginTop: 12 }} data-testid="trip-map">
              <MapContainer center={[trip.position.lat, trip.position.lon]} zoom={12} style={{ height: '100%' }}>
                <TileLayer url={TILE_URL} />
                <Marker position={[trip.position.lat, trip.position.lon]} icon={pinIcon('idle', true)} />
                <FitToTruck lat={trip.position.lat} lon={trip.position.lon} />
              </MapContainer>
            </div>
          )}
          <Button style={{ marginTop: 12 }} onClick={() => openPdf(trip.id)}>
            {t('truck_board.documents_pdf')}
          </Button>
        </>
      )}
    </Drawer>
  );
}
