import { Button, Descriptions, Drawer, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { openTripDocument } from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { TripMiniMap } from './TripMiniMap';
import { rejectionFailed } from './truckBoardHelpers';
import { useTripMessages } from './useTripMessages';

interface ITripDrawerProps {
  trip: IExternalTrip | null;
  canReject: boolean;
  onReject: (trip: IExternalTrip) => void;
  onClose: () => void;
}

export function TripDrawer({ trip, canReject, onReject, onClose }: ITripDrawerProps) {
  const { t } = useTranslation();
  const messages = useTripMessages();
  const openPdf = (tripId: number) =>
    openTripDocument(tripId).catch(() => toast.error(t('truck_board.error.pdf')));
  const vehicle = (plate: string, brand: string | null, model: string | null, company: string | null) =>
    [plate, [brand, model].filter(Boolean).join(' '), company].filter(Boolean).join(' · ');
  const canRejectTrip = canReject && trip !== null && !trip.shipment && (!trip.rejected_at || rejectionFailed(trip));
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
            {trip.rejected_at && (
              <Descriptions.Item label={t('truck_board.rejected_label')}>
                {trip.rejection_reason} · {trip.rejected_by_name ?? '—'} · {trip.rejected_at.slice(0, 16).replace('T', ' ')}
              </Descriptions.Item>
            )}
          </Descriptions>
          {rejectionFailed(trip) && (
            <Typography.Text type="danger" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
              {messages.pushError(trip.last_push_error ?? '')}
            </Typography.Text>
          )}
          {trip.position && <TripMiniMap lat={trip.position.lat} lon={trip.position.lon} height={220} />}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button onClick={() => openPdf(trip.id)}>{t('truck_board.documents_pdf')}</Button>
            {canRejectTrip && (
              <Button danger onClick={() => onReject(trip)}>{t('truck_board.reject')}</Button>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
