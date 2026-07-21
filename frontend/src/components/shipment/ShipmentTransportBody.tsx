import { useTranslation } from 'react-i18next';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import { fmt } from '@/pages/export/ShipmentDetailHelpers.helpers';
import type { IShipmentDetail } from '@/types';

interface IShipmentTransportBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * "Transport & Transit" card body: the editable `transport` field group
 * (now including `border_point`, moved here from Destination & Plan) plus
 * the border/arrival timestamps, which are read-only because only
 * `transition_to()` writes them.
 */
export function ShipmentTransportBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentTransportBodyProps) {
  const { t } = useTranslation();

  const timestamps: [string, string | null][] = [
    ['shipment_detail.border_crossed', shipment.border_crossed_at],
    ['shipment_detail.arrived', shipment.arrived_at],
  ];

  return (
    <>
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="transport"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
      <div style={{ marginTop: 12 }}>
        {timestamps.map(([labelKey, value]) => (
          <InfoRow key={labelKey} label={t(labelKey)} value={fmt(value)} />
        ))}
      </div>
    </>
  );
}
