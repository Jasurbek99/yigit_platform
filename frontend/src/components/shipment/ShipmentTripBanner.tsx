import { Alert, Button, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { tripDocumentUrl, useAcceptTripChange, useShipmentTrip } from '@/hooks/useExternalTrips';

export function ShipmentTripBanner({ shipmentId, canEdit }: { shipmentId: number; canEdit: boolean }) {
  const { t } = useTranslation();
  const { data: trip } = useShipmentTrip(shipmentId);
  const accept = useAcceptTripChange();
  if (!trip) return null;
  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }}>
      <Space>
        <Tag color="blue">{t('truck_board.trip')}: {trip.trip_number ?? t('truck_board.awaiting_code')}</Tag>
        <Tag>{trip.status}</Tag>
        <Button size="small" onClick={() => window.open(tripDocumentUrl(trip.id), '_blank')}>
          {t('truck_board.documents_pdf')}
        </Button>
      </Space>
      {trip.conflict_note && (
        <Alert type="error" showIcon message={trip.conflict_note} action={canEdit && (
          <Button size="small" danger loading={accept.isPending}
            onClick={() => accept.mutate({ tripId: trip.id }, {
              onSuccess: () => toast.success(t('truck_board.accepted')),
              onError: () => toast.error(t('truck_board.error.generic')),
            })}>
            {t('truck_board.accept_change')}
          </Button>
        )} />
      )}
      {trip.last_push_error && <Alert type="warning" showIcon message={trip.last_push_error} />}
    </Space>
  );
}
