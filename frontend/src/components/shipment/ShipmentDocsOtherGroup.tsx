import { useTranslation } from 'react-i18next';

import { DocumentDownloadRow } from '@/components/shipment/DocumentDownloadRow';
import { DocumentFileRow } from '@/components/shipment/DocumentFileRow';
import { DocumentGroup } from '@/components/shipment/DocumentGroup';
import { TripPdfRow } from '@/components/shipment/TripPdfRow';
import { useAuth } from '@/hooks/useAuth';
import type { IShipmentDetail } from '@/types';
import { canSeePage } from '@/utils/permissions';

interface IShipmentDocsOtherGroupProps {
  readonly shipment: IShipmentDetail;
}

/**
 * Everything else the shipment has on file: the pallet QR label (needs the
 * export code it prints), the Planning trip PDF (its endpoint is a Truck Board
 * read, so it is offered only to who can open the Truck Board) and the
 * uploaded quality-certificate scans.
 */
export function ShipmentDocsOtherGroup({ shipment }: IShipmentDocsOtherGroupProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canTripPdf = !shipment.is_gapy_satys && Boolean(shipment.trip_id) && canSeePage(user, 'export.truck_board');
  const certificates = shipment.quality?.certificates ?? [];
  if (!shipment.export_code && !canTripPdf && certificates.length === 0) return null;

  return (
    <DocumentGroup title={t('shipment_detail.docs.group_other')}>
      {shipment.export_code && (
        <DocumentDownloadRow
          label={t('shipment_detail.docs.qr_label')}
          formats={[{ label: t('documents.pdf'), path: `/export/shipments/${shipment.id}/label/` }]}
        />
      )}
      {canTripPdf && <TripPdfRow shipmentId={shipment.id} />}
      {certificates.map((certificate) => (
        <DocumentFileRow
          key={certificate.id}
          label={`${t(`quality.${certificate.doc_type}`)} · ${certificate.original_filename}`}
          href={certificate.download_url}
          filename={certificate.original_filename}
        />
      ))}
    </DocumentGroup>
  );
}
