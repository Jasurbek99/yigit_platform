import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { EDIT_FIELD_GROUPS, type IEditFieldGroup } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';

/** Look a group up by key. Keys are a closed union, so this cannot miss. */
export const groupByKey = (key: IEditFieldGroup['key']): IEditFieldGroup =>
  EDIT_FIELD_GROUPS.find((g) => g.key === key)!;

/** How many of a group's fields the backend reports as still owed. */
export function countMissing(groupKey: IEditFieldGroup['key'], missingKeys: Set<string>): number {
  return groupByKey(groupKey).fields.filter((f) => missingKeys.has(f.key)).length;
}

interface IShipmentFieldGroupProps {
  shipment: IShipmentDetail;
  groupKey: IEditFieldGroup['key'];
  /** Keys from `shipment.completeness.missing_fields` — drives row highlighting. */
  missingKeys: Set<string>;
  readOnly: boolean;
}

/**
 * Renders every editable row of one `EDIT_FIELD_GROUPS` group, highlighting
 * the rows the backend still considers outstanding.
 */
export function ShipmentFieldGroup({
  shipment,
  groupKey,
  missingKeys,
  readOnly,
}: IShipmentFieldGroupProps) {
  return (
    <div>
      {groupByKey(groupKey).fields.map((config) => (
        <DetailFieldRow
          key={config.key}
          shipment={shipment}
          config={config}
          readOnly={readOnly}
          isMissing={missingKeys.has(config.key)}
        />
      ))}
    </div>
  );
}
