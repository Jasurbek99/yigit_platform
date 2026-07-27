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
  /** Opens the comments drawer for one field's thread. Omit to hide the 💬 icon. */
  onOpenComments?: (fieldKey: string) => void;
  /** field_key → live comment count, for the 💬 icon's badge. */
  commentCountsByField?: Record<string, number>;
  /**
   * Field keys to skip — for a group whose card renders one of its fields
   * standalone elsewhere (e.g. `harvest_status` in the `goods` group, shown
   * ahead of the variety block by ShipmentGoodsBody) so it isn't rendered
   * twice. The field stays part of the group for every other consumer
   * (completeness chip, section scroll-jump, kanban overflow panel, the
   * generic multi-group edit drawer) — only this render skips it.
   */
  excludeKeys?: readonly string[];
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
  onOpenComments,
  commentCountsByField,
  excludeKeys,
}: IShipmentFieldGroupProps) {
  const fields = excludeKeys
    ? groupByKey(groupKey).fields.filter((f) => !excludeKeys.includes(f.key))
    : groupByKey(groupKey).fields;

  return (
    <div>
      {fields.map((config) => (
        <DetailFieldRow
          key={config.key}
          shipment={shipment}
          config={config}
          readOnly={readOnly}
          isMissing={missingKeys.has(config.key)}
          onOpenComments={onOpenComments ? () => onOpenComments(config.key) : undefined}
          commentCount={commentCountsByField?.[config.key] ?? 0}
        />
      ))}
    </div>
  );
}
