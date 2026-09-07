import { Modal, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem } from '@/types';
import { ShipmentTruckLocationBlock } from '@/components/shipment/ShipmentTruckLocationBlock';

const MAP_HEIGHT = 380;

/**
 * The Sheet's R15 "Vehicle Current Position / ETA" map — a Modal around the
 * shared `ShipmentTruckLocationBlock`, the same block Shipment Detail shows
 * inline as a Card.
 *
 * Mounted only while open: the block polls every 30s and the Sheet renders
 * hundreds of cells at once, so `SheetCell` renders this conditionally (and
 * lazily, keeping Leaflet out of the Sheet chunk until the first pin click).
 *
 * `canEdit={false}` on purpose — the block's manual device picker is an edit
 * decision the Sheet deliberately does not make. Linking a device stays on the
 * Shipment Detail page.
 */
export function ShipmentTruckMapModal({
  shipment,
  onClose,
}: {
  shipment: IShipmentSheetItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // A truck can be named either by an explicit fleet selection or by a typed
  // plate; the backend resolver accepts both, so "no truck" means neither.
  const hasTruck = Boolean(shipment.truck_plate || shipment.truck_head_id);

  return (
    <Modal
      open
      destroyOnHidden
      footer={null}
      width={720}
      onCancel={onClose}
      title={
        <Space>
          {t('fleet_map.shipment_card_title')}
          <Typography.Text type="secondary">{shipment.shipment_code}</Typography.Text>
        </Space>
      }
    >
      <ShipmentTruckLocationBlock
        shipmentId={shipment.id}
        hasTruck={hasTruck}
        canEdit={false}
        mapHeight={MAP_HEIGHT}
      />
    </Modal>
  );
}
