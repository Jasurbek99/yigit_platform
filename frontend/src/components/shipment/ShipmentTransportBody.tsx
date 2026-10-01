import { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { DetailExtraFieldRows } from '@/components/shipment/DetailExtraFieldRows';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { ShipmentTripBanner } from '@/components/shipment/ShipmentTripBanner';
import { TripPickerModal } from '@/components/shipment/TripPickerModal';
import { canManageTrips } from '@/components/shipment/tripAccess';
import {
  DETAIL_EXTRA_FIELDS, DRIVER_NAME_FIELD, SECOND_RIG_KEYS, TRUCK_PLATE_FIELD,
} from '@/constants/shipmentEditConfig';
import { useAuth } from '@/hooks/useAuth';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import { TRIP_LOCKED_FIELDS } from '@/utils/sheetPermissions';
import type { IShipmentDetail } from '@/types';

interface IShipmentTransportBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * "Transport & Transit" card = the transport part (spec 2026-09-30 §1).
 *
 * Regular shipments get their truck from a Planning trip (transport-trips
 * spec D9/D10): the trip block offers «choose» while the shipment is in
 * Preparation without a trip, and «unlink» on the banner once linked. Truck
 * and driver are then read-only here — they come from the trip (or, for
 * shipments from before trips, from the old fleet pick). Gapy-Satys keeps
 * typed-in truck and driver.
 */
export function ShipmentTransportBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentTransportBodyProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const isGapy = shipment.is_gapy_satys;
  // A Planning trip owns tractor/trailer/driver (backend PATCH refuses them with 400 trip_locked).
  const isTripLinked = !!shipment.trip_id && !isGapy;
  const canTrips = !readOnly && canManageTrips(user);
  const showChoose = canTrips && !shipment.trip_id && shipment.status_code === 'draft';

  const rowProps = (key: string) => ({
    isMissing: missingKeys.has(key),
    onOpenComments: onOpenComments ? () => onOpenComments(key) : undefined,
    commentCount: commentCountsByField?.[key] ?? 0,
  });

  return (
    <>
      {!isGapy && (
        <div id="detail-field-trip_id" style={{ marginBottom: 8 }}>
          <ShipmentTripBanner shipmentId={shipment.id} canEdit={!readOnly} canUnlink={canTrips} />
          {showChoose && (
            <Tooltip title={shipment.country_code ? undefined : t('shipment_detail.parts.need_country')}>
              <Button type="primary" size="small" disabled={!shipment.country_code} onClick={() => setPickerOpen(true)}>
                {t('shipment_detail.parts.choose_trip')}
              </Button>
            </Tooltip>
          )}
          {pickerOpen && <TripPickerModal shipment={shipment} onClose={() => setPickerOpen(false)} />}
        </div>
      )}
      <DetailFieldRow shipment={shipment} config={TRUCK_PLATE_FIELD} readOnly={readOnly || !isGapy} {...rowProps(TRUCK_PLATE_FIELD.key)} />
      <DetailFieldRow shipment={shipment} config={DRIVER_NAME_FIELD} readOnly={readOnly || !isGapy} {...rowProps(DRIVER_NAME_FIELD.key)} />
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="transport"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
        excludeKeys={[TRUCK_PLATE_FIELD.key, DRIVER_NAME_FIELD.key]}
        lockedKeys={isTripLinked ? [...TRIP_LOCKED_FIELDS] : undefined}
      />
      {isTripLinked && shipment.driver_passport_expiry && (
        <InfoRow label={t('truck_board.passport_valid_until')} value={shipment.driver_passport_expiry} />
      )}
      <DetailExtraFieldRows
        shipment={shipment}
        fields={DETAIL_EXTRA_FIELDS.transport}
        missingKeys={missingKeys}
        readOnly={readOnly}
        lockedKeys={isTripLinked ? SECOND_RIG_KEYS : undefined}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
    </>
  );
}
