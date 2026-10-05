import { useTranslation } from 'react-i18next';
import { Button, Popover } from 'antd';
import { IconLink } from '@tabler/icons-react';

import { ShipmentFirmContractsPanel } from '@/components/sheet/ShipmentFirmContractsPanel';

interface ILinkContractButtonProps {
  readonly shipmentId: number;
}

/**
 * No contract yet → reuse the Sheet's firm→contract linking panel
 * (whole-truck). Linking creates the bridge sale; the panel's mutation
 * invalidates 'document-packets', so the firm's documents then appear.
 */
export function LinkContractButton({ shipmentId }: ILinkContractButtonProps) {
  const { t } = useTranslation();
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      destroyTooltipOnHide
      content={<ShipmentFirmContractsPanel shipmentId={shipmentId} />}
    >
      <Button size="small" type="dashed" icon={<IconLink size={14} />}>
        {t('documents_page.link_contract')}
      </Button>
    </Popover>
  );
}
