import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { ShipmentFirmSelector } from '@/components/shipment/ShipmentFirmSelector';
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
 * the export-firm picker. `firm_splits` is a junction table (not a scalar
 * field), so `ShipmentFirmSelector` writes it through its own endpoint; it
 * falls back to the read-only `export_firms_display` string when `readOnly`.
 */
export function ShipmentDestinationBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentDestinationBodyProps) {
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
      <ShipmentFirmSelector shipment={shipment} readOnly={readOnly} />
    </>
  );
}
