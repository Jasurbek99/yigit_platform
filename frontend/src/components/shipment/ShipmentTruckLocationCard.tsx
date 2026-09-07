import { Card } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentTruckLocationBlock } from './ShipmentTruckLocationBlock';

/**
 * Shipment Detail's truck-location card — a Card around the shared
 * `ShipmentTruckLocationBlock`. The Sheet's R15 pin wraps the same block in a
 * Modal (`components/sheet/ShipmentTruckMapModal`); everything the two screens
 * show about a truck lives in the block so they cannot drift apart again.
 */
export function ShipmentTruckLocationCard({
  shipmentId,
  hasTruck,
  canEdit,
}: {
  shipmentId: number;
  /** `truck_plate || truck_head_id` — see the block's prop docs. */
  hasTruck: boolean;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card title={t('fleet_map.shipment_card_title')} style={{ marginBottom: 8 }}>
      <ShipmentTruckLocationBlock shipmentId={shipmentId} hasTruck={hasTruck} canEdit={canEdit} />
    </Card>
  );
}
