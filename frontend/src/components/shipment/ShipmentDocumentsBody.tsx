import { useTranslation } from 'react-i18next';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import { fmt } from '@/pages/export/ShipmentDetailHelpers.helpers';
import type { IShipmentDetail } from '@/types';

interface IShipmentDocumentsBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * "Documents & Customs" card body: the editable `status` field group (docs
 * status, planned customs day) and the loading/customs timestamps, which
 * are read-only because only `transition_to()` writes them. Harvest status
 * moved to the Goods & Loading card (see `HARVEST_STATUS_FIELD` in
 * shipmentEditConfig.ts). The quality certificates and the
 * border/arrival/sale timestamps moved to their own Quality Certificates,
 * Transport & Transit, and Sale cards respectively.
 */
export function ShipmentDocumentsBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentDocumentsBodyProps) {
  const { t } = useTranslation();

  const timestamps: [string, string | null][] = [
    ['shipment_detail.loading_started', shipment.loading_started_at],
    ['shipment_detail.customs_entry', shipment.customs_entry_at],
    ['shipment_detail.customs_exit', shipment.customs_exit_at],
  ];

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

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          {t('shipment_detail.section_timestamps')}
        </div>
        {timestamps.map(([labelKey, value]) => (
          <InfoRow key={labelKey} label={t(labelKey)} value={fmt(value)} />
        ))}
      </div>
    </>
  );
}
