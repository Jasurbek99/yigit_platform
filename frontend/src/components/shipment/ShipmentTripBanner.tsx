import { Alert, Button, Modal, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { openTripDocument, useAcceptTripChange, useShipmentTrip, useUnassignTrip } from '@/hooks/useExternalTrips';
import { apiErrorKey } from '@/pages/export/truckBoard/truckBoardHelpers';
import { useTripMessages } from '@/pages/export/truckBoard/useTripMessages';

interface IShipmentTripBannerProps {
  shipmentId: number;
  canEdit: boolean;
  /** Show «Отвязать» (caller checked canManageTrips and read-only). */
  canUnlink?: boolean;
}

export function ShipmentTripBanner({ shipmentId, canEdit, canUnlink = false }: IShipmentTripBannerProps) {
  const { t } = useTranslation();
  const messages = useTripMessages();
  const { data: trip } = useShipmentTrip(shipmentId);
  const accept = useAcceptTripChange();
  const unassign = useUnassignTrip();
  if (!trip) return null;
  const conflict = messages.conflict(trip);
  const openPdf = () => openTripDocument(trip.id).catch(() => toast.error(t('truck_board.error.pdf')));
  const confirmUnlink = () => Modal.confirm({
    title: t('truck_board.unlink_confirm'),
    okText: t('packing.confirm_ok'),
    cancelText: t('packing.confirm_cancel'),
    onOk: () => unassign.mutate({ tripId: trip.id }, {
      onSuccess: () => toast.success(t('shipment_detail.parts.trip_unlinked')),
      onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
    }),
  });
  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }}>
      <Space>
        <Tag color="blue">{t('truck_board.trip')}: {trip.trip_number ?? t('truck_board.awaiting_code')}</Tag>
        <Tag>{messages.status(trip.status)}</Tag>
        <Button size="small" onClick={openPdf}>{t('truck_board.documents_pdf')}</Button>
        {canUnlink && (
          <Button size="small" danger loading={unassign.isPending} onClick={confirmUnlink}>
            {t('truck_board.unlink')}
          </Button>
        )}
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
