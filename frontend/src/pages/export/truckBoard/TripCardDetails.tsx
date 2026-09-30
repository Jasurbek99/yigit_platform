import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { openTripDocument } from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { TripMiniMap } from './TripMiniMap';
import { useTripMessages } from './useTripMessages';

const { Text } = Typography;

interface ITripCardDetailsProps {
  trip: IExternalTrip;
}

function vehicle(brand: string | null, model: string | null, company: string | null): string {
  return [[brand, model].filter(Boolean).join(' '), company].filter(Boolean).join(' · ') || '—';
}

/** The trip card's expanded part: vehicles, driver, visas, Planning status, mini map, PDF. */
export function TripCardDetails({ trip }: ITripCardDetailsProps) {
  const { t } = useTranslation();
  const messages = useTripMessages();
  const row = (label: string, value: string) => (
    <div style={{ fontSize: 12 }}>
      <Text type="secondary">{label}: </Text>{value}
    </div>
  );
  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed #f0f0f0', paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
      {row(t('truck_board.tractor'), vehicle(trip.tractor_brand, trip.tractor_model, trip.tractor_company))}
      {row(t('truck_board.trailer'), vehicle(trip.trailer_brand, trip.trailer_model, trip.trailer_company))}
      {row(t('truck_board.phone'), trip.driver_phone ?? '—')}
      {row(t('truck_board.passport'), trip.driver_passport_number
        ? `${trip.driver_passport_number} · ${t('truck_board.valid_until')} ${trip.driver_passport_expiry ?? '—'}`
        : '—')}
      {row(t('truck_board.visas'), trip.visas.length
        ? trip.visas.map((v) => `${v.country} — ${v.expiry_date}`).join(', ')
        : '—')}
      {row(t('truck_board.trip'), `${trip.trip_number ?? t('truck_board.awaiting_code')} · ${messages.status(trip.status)}`)}
      {trip.position && <TripMiniMap lat={trip.position.lat} lon={trip.position.lon} height={160} />}
      <Button size="small" style={{ marginTop: 8 }}
        onClick={() => openTripDocument(trip.id).catch(() => toast.error(t('truck_board.error.pdf')))}>
        {t('truck_board.documents_pdf')}
      </Button>
    </div>
  );
}
