import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { toast } from 'sonner';

import { DocumentRowShell } from '@/components/shipment/DocumentRowShell';
import { openTripDocument, useShipmentTrip } from '@/hooks/useExternalTrips';

interface ITripPdfRowProps {
  readonly shipmentId: number;
}

/** The Planning trip's own PDF, proxied from Planning and opened in a new tab. */
export function TripPdfRow({ shipmentId }: ITripPdfRowProps) {
  const { t } = useTranslation();
  const { data: trip } = useShipmentTrip(shipmentId);
  if (!trip) return null;

  const handleOpen = (): void => {
    openTripDocument(trip.id).catch(() => toast.error(t('truck_board.error.pdf')));
  };

  return (
    <DocumentRowShell label={t('truck_board.documents_pdf')}>
      <Button size="small" onClick={handleOpen}>{t('shipment_detail.docs.open')}</Button>
    </DocumentRowShell>
  );
}
