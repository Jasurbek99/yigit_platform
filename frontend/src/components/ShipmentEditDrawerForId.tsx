import { Drawer, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { ShipmentEditDrawer } from '@/components/ShipmentEditDrawer';
import type { IEditFieldGroup } from '@/constants/shipmentEditConfig';

interface IShipmentEditDrawerForIdProps {
  shipmentId: number | null;
  onClose: () => void;
  groupKey?: IEditFieldGroup['key'];
}

/**
 * Wrapper that fetches the shipment detail by id and renders the edit drawer
 * once data is loaded. Used from the List page where rows only carry the
 * lightweight IShipmentListItem shape.
 */
export function ShipmentEditDrawerForId({
  shipmentId,
  onClose,
  groupKey,
}: IShipmentEditDrawerForIdProps) {
  const { t } = useTranslation();
  const { data: shipment, isLoading } = useShipmentDetail(shipmentId ?? undefined);

  if (shipmentId == null) return null;

  if (isLoading || !shipment) {
    return (
      <Drawer open onClose={onClose} title={t('shipment_edit_drawer.title')} width={480}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Drawer>
    );
  }

  return (
    <ShipmentEditDrawer
      open
      onClose={onClose}
      shipment={shipment}
      groupKey={groupKey}
    />
  );
}
