import { useTranslation } from 'react-i18next';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import type { IShipmentDetail } from '@/types';

interface IShipmentDestinationBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * "Destination & Plan" card body: the editable `logistics` field group plus
 * a read-only Export Firm(s) row. `export_firms_display` is a comma-joined
 * string derived server-side from `firm_splits` — not a patchable field, so
 * it renders as an InfoRow rather than a DetailFieldRow.
 */
export function ShipmentDestinationBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentDestinationBodyProps) {
  const { t } = useTranslation();

  return (
    <>
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="logistics"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
      <InfoRow label={t('shipments.export_firms')} value={shipment.export_firms_display ?? '—'} />
    </>
  );
}
