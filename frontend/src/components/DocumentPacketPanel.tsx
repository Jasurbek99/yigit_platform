import { useTranslation } from 'react-i18next';
import { Button, Popover, Space, Tag, Typography } from 'antd';
import { IconLink } from '@tabler/icons-react';

import { CmrDocumentsButton } from '@/components/CmrDocumentsButton';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
import { ShipmentFirmContractsPanel } from '@/components/sheet/ShipmentFirmContractsPanel';
import type { IDocumentPacket } from '@/types';

interface IDocumentPacketPanelProps {
  readonly packet: IDocumentPacket;
}

/**
 * One truck's document packet (the expanded row on the Documents page): the
 * truck-level CMR at the top, then a row per export firm with that firm's
 * invoice / letters. The CMR is disabled until the truck's packing is complete.
 */
export function DocumentPacketPanel({ packet }: IDocumentPacketPanelProps) {
  const { t } = useTranslation();

  return (
    <Space direction="vertical" size="small" style={{ width: '100%', padding: '4px 8px' }}>
      <Space wrap>
        <Typography.Text strong>{t('documents.cmr')}:</Typography.Text>
        <CmrDocumentsButton shipmentId={packet.id} disabled={!packet.packing_complete} />
        {!packet.packing_complete && (
          <Typography.Text type="warning">
            {t('documents_page.packing_incomplete')}
          </Typography.Text>
        )}
      </Space>

      {packet.firms.map((firm) => (
        <Space key={firm.export_firm_id} wrap>
          <Tag>{firm.export_firm_name}</Tag>
          {firm.sale_id !== null ? (
            <InvoiceDocumentsButton invoiceId={firm.sale_id} size="small" />
          ) : (
            // No contract yet → reuse the Sheet's firm→contract linking panel
            // (whole-truck). Linking creates the bridge sale; the panel's mutation
            // invalidates 'document-packets', so the invoice buttons then appear.
            <Popover
              trigger="click"
              placement="bottomLeft"
              destroyTooltipOnHide
              content={<ShipmentFirmContractsPanel shipmentId={packet.id} />}
            >
              <Button size="small" type="dashed" icon={<IconLink size={14} />}>
                {t('documents_page.link_contract')}
              </Button>
            </Popover>
          )}
        </Space>
      ))}
    </Space>
  );
}
