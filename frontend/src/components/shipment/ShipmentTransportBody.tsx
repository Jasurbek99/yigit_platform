import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { ShipmentTruckSelector } from '@/components/shipment/ShipmentTruckSelector';
import { TRUCK_PLATE_FIELD } from '@/constants/shipmentEditConfig';
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
 *
 * `truck_plate` (the group's first field) renders standalone ahead of the
 * rest of the group — Gapy-Satys shipments (no fleet linkage) keep the plain
 * text `DetailFieldRow`, everyone else gets `ShipmentTruckSelector` (fleet
 * head/trailer dropdowns that derive `truck_plate`). Same pull-one-field-out
 * pattern as `harvest_status` in ShipmentGoodsBody — `excludeKeys` skips it
 * in the group loop so the completeness chip still counts it once.
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
      {shipment.is_gapy_satys ? (
        // DetailFieldRow assigns its own `#detail-field-truck_plate` id —
        // no wrapper needed, and one would create a duplicate id in the DOM.
        <DetailFieldRow
          shipment={shipment}
          config={TRUCK_PLATE_FIELD}
          readOnly={readOnly}
          isMissing={missingKeys.has(TRUCK_PLATE_FIELD.key)}
          onOpenComments={onOpenComments ? () => onOpenComments(TRUCK_PLATE_FIELD.key) : undefined}
          commentCount={commentCountsByField?.[TRUCK_PLATE_FIELD.key] ?? 0}
        />
      ) : (
        // ShipmentTruckSelector has no built-in id — wrap it so the
        // scroll-jump target (#detail-field-truck_plate, used by
        // OtherTasksRow / ShipmentDetailHelpers.jumpToField) still resolves.
        <div id="detail-field-truck_plate">
          <ShipmentTruckSelector shipment={shipment} readOnly={readOnly} />
        </div>
      )}
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="transport"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
        excludeKeys={[TRUCK_PLATE_FIELD.key]}
      />
      <div style={{ marginTop: 12 }}>
        {timestamps.map(([labelKey, value]) => (
          <InfoRow key={labelKey} label={t(labelKey)} value={fmt(value)} />
        ))}
      </div>
    </>
  );
}
