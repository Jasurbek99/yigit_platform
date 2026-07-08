import { useTranslation } from 'react-i18next';
import { Alert, Button, Popover, Space, Tag, Typography } from 'antd';
import { IconLink, IconScale } from '@tabler/icons-react';

import { CmrDocumentsButton } from '@/components/CmrDocumentsButton';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
import { ShipmentFirmContractsPanel } from '@/components/sheet/ShipmentFirmContractsPanel';
import { ShipmentPackingPanel } from '@/components/sheet/ShipmentPackingPanel';
import type { IDocumentPacket } from '@/types';

interface IDocumentPacketPanelProps {
  readonly packet: IDocumentPacket;
}

/**
 * One truck's document packet (the expanded row on the Documents page): a
 * readiness banner listing anything still to fill, the truck-level CMR, then a
 * row per export firm with that firm's invoice / letters. The CMR is disabled
 * until the truck is ready (setup + packing done).
 */
export function DocumentPacketPanel({ packet }: IDocumentPacketPanelProps) {
  const { t } = useTranslation();

  return (
    <Space direction="vertical" size="small" style={{ width: '100%', padding: '4px 8px' }}>
      {packet.missing_setup.length > 0 && (
        // Show WHAT is missing (edited on the Sheet), so the team understands why
        // the truck isn't document-ready instead of it silently not appearing.
        <Alert
          type="warning"
          showIcon
          message={t('documents_page.complete_on_sheet', {
            fields: packet.missing_setup.map((f) => t(`documents_page.field.${f}`)).join(', '),
          })}
        />
      )}

      <Space wrap>
        <Typography.Text strong>{t('documents.cmr')}:</Typography.Text>
        <CmrDocumentsButton shipmentId={packet.id} disabled={!packet.is_ready} />
        {!packet.packing_complete && (
          // Packing not settled → generation is blocked. Reuse the Sheet's packing
          // panel here (its mutation invalidates 'document-packets'), so the truck
          // can be packed without leaving the page; the CMR then enables.
          <Popover
            trigger="click"
            placement="bottomLeft"
            destroyTooltipOnHide
            content={<ShipmentPackingPanel shipmentId={packet.id} />}
          >
            <Button size="small" type="dashed" danger icon={<IconScale size={14} />}>
              {t('documents_page.fill_packing')}
            </Button>
          </Popover>
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
