import { useTranslation } from 'react-i18next';
import { Button, Popover } from 'antd';
import { IconScale } from '@tabler/icons-react';

import { ShipmentPackingPanel } from '@/components/sheet/ShipmentPackingPanel';

interface IFillPackingButtonProps {
  readonly shipmentId: number;
}

/**
 * Packing not settled → generation is blocked. Reuses the Sheet's packing
 * panel (its mutation invalidates 'document-packets'), so the truck can be
 * packed without leaving the page; the documents then enable.
 */
export function FillPackingButton({ shipmentId }: IFillPackingButtonProps) {
  const { t } = useTranslation();
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      destroyTooltipOnHide
      content={<ShipmentPackingPanel shipmentId={shipmentId} />}
    >
      <Button size="small" type="dashed" danger icon={<IconScale size={14} />}>
        {t('documents_page.fill_packing')}
      </Button>
    </Popover>
  );
}
