import { Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDetail } from '@/types';
import { DriverSelect } from '@/components/DriverSelect';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';

interface IShipmentDriverSelectorProps {
  shipment: IShipmentDetail;
  readOnly: boolean;
}

/**
 * Driver picker for the ShipmentDetail transport card and the edit drawer.
 * Replaces the free-text `driver_name` field for non-Gapy-Satys shipments, the
 * same way ShipmentTruckSelector replaces `truck_plate`.
 *
 * Writes `driver_id` and `driver_name` in ONE patch. Editing the name as free
 * text here (the previous behaviour) left `driver_id` pointing at whoever was
 * picked before — a link that is wrong rather than merely absent.
 *
 * `driver_phone` stays a plain text row in the group: separate cell, separate
 * history, operator-typed, and the registry has no phone to supply.
 *
 * Gapy-Satys shipments keep the plain text field — local buyers bring their own
 * truck and their own driver (see ShipmentTransportBody).
 */
export function ShipmentDriverSelector({ shipment, readOnly }: IShipmentDriverSelectorProps) {
  const { t } = useTranslation();
  const { mutate } = useShipmentPatchMulti();

  const label = t('shipment_edit_drawer.field.driver_name');
  const driverId = shipment.driver_id ?? null;

  function save(id: number | null, name: string) {
    // Re-picking the same driver is a no-op — don't spend a PATCH and an audit
    // row on it (same guard SheetDriverSelectEditor applies before committing).
    if (id === driverId) return;
    mutate({ id: shipment.id, fields: { driver_id: id, driver_name: name } });
  }

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {label}
        </Typography.Text>
        <DriverSelect value={driverId} onChange={save} disabled={readOnly} ariaLabel={label} />
      </div>
    </Space>
  );
}
