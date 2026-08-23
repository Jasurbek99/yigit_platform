import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { ShipmentTruckSelector } from '@/components/shipment/ShipmentTruckSelector';
import { ShipmentDriverSelector } from '@/components/shipment/ShipmentDriverSelector';
import { TRUCK_PLATE_FIELD, DRIVER_NAME_FIELD } from '@/constants/shipmentEditConfig';
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
 * `truck_plate` and `driver_name` (the group's first two fields) render
 * standalone ahead of the rest of the group — Gapy-Satys shipments (no fleet
 * linkage, buyer's own truck and own driver) keep the plain text
 * `DetailFieldRow`, everyone else gets `ShipmentTruckSelector` (fleet
 * head/trailer dropdowns that derive `truck_plate`) and
 * `ShipmentDriverSelector` (registry dropdown that writes `driver_id`
 * alongside the name). Same pull-one-field-out pattern as `harvest_status` in
 * ShipmentGoodsBody — `excludeKeys` skips them in the group loop so the
 * completeness chip still counts each once. `driver_phone` deliberately stays
 * inside the group as a plain text row.
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
      {shipment.is_gapy_satys ? (
        <DetailFieldRow
          shipment={shipment}
          config={DRIVER_NAME_FIELD}
          readOnly={readOnly}
          isMissing={missingKeys.has(DRIVER_NAME_FIELD.key)}
          onOpenComments={onOpenComments ? () => onOpenComments(DRIVER_NAME_FIELD.key) : undefined}
          commentCount={commentCountsByField?.[DRIVER_NAME_FIELD.key] ?? 0}
        />
      ) : (
        // Same id-wrapper reason as truck_plate above — the selector has no
        // built-in id, and jumpToField targets #detail-field-driver_name.
        <div id="detail-field-driver_name">
          <ShipmentDriverSelector shipment={shipment} readOnly={readOnly} />
        </div>
      )}
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="transport"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
        excludeKeys={[TRUCK_PLATE_FIELD.key, DRIVER_NAME_FIELD.key]}
      />
      <div style={{ marginTop: 12 }}>
        {timestamps.map(([labelKey, value]) => (
          <InfoRow key={labelKey} label={t(labelKey)} value={fmt(value)} />
        ))}
      </div>
    </>
  );
}
