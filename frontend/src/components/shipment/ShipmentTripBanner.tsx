import { Alert, Button, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { openTripDocument, useAcceptTripChange, useShipmentTrip } from '@/hooks/useExternalTrips';
import { apiErrorKey } from '@/pages/export/truckBoard/truckBoardHelpers';
import { useTripMessages } from '@/pages/export/truckBoard/useTripMessages';

interface IShipmentTripBannerProps {
  shipmentId: number;
  canEdit: boolean;
}

export function ShipmentTripBanner({ shipmentId, canEdit }: IShipmentTripBannerProps) {
  const { t } = useTranslation();
  const messages = useTripMessages();
  const { data: trip } = useShipmentTrip(shipmentId);
  const accept = useAcceptTripChange();
  if (!trip) return null;
  const conflict = messages.conflict(trip);
  const openPdf = () => openTripDocument(trip.id).catch(() => toast.error(t('truck_board.error.pdf')));
  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }}>
      <Space>
        <Tag color="blue">{t('truck_board.trip')}: {trip.trip_number ?? t('truck_board.awaiting_code')}</Tag>
        <Tag>{messages.status(trip.status)}</Tag>
        <Button size="small" onClick={openPdf}>{t('truck_board.documents_pdf')}</Button>
      </Space>
      {conflict && (
        <Alert type="error" showIcon message={conflict} action={canEdit && (
          <Button size="small" danger loading={accept.isPending}
            onClick={() => accept.mutate({ tripId: trip.id }, {
              onSuccess: () => toast.success(t('truck_board.accepted')),
              onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
            })}>
            {t('truck_board.accept_change')}
          </Button>
        )} />
      )}
      {trip.last_push_error && <Alert type="warning" showIcon message={messages.pushError(trip.last_push_error)} />}
    </Space>
  );
}
