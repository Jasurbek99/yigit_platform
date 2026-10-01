import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { DetailExtraFieldRows } from '@/components/shipment/DetailExtraFieldRows';
import { ShipmentPackingPanel } from '@/components/sheet/ShipmentPackingPanel';
import { DETAIL_EXTRA_FIELDS } from '@/constants/shipmentEditConfig';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import type { IShipmentDetail } from '@/types';

interface IShipmentDocumentsBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * "Documents & Customs" card — the documents half of the export part (spec
 * 2026-09-30 §3): docs status and planned customs day, the documents note,
 * both customs timestamps, the advance answer (give_advance target), and the
 * packing panel — the ONE place gross / boxes / pallets are entered; the CMR
 * reads its template first.
 */
export function ShipmentDocumentsBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentDocumentsBodyProps) {
  const { t } = useTranslation();

  return (
    <>
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="status"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
      <DetailExtraFieldRows
        shipment={shipment}
        fields={DETAIL_EXTRA_FIELDS.status}
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
      <div id="detail-field-has_current_advance">
        <InfoRow
          label={t('sheet.row.doc_advance')}
          value={
            <Link to={`/export/advances?shipment=${shipment.id}`}>
              {shipment.has_current_advance ? t('common.yes') : t('common.no')}
            </Link>
          }
        />
      </div>
      <div id="detail-field-packing_template" style={{ marginTop: 12 }}>
        {readOnly ? (
          <InfoRow label={t('sheet.packing.title')} value={shipment.packing_template_name ?? '—'} />
        ) : (
          <ShipmentPackingPanel shipmentId={shipment.id} width="100%" />
        )}
      </div>
    </>
  );
}
