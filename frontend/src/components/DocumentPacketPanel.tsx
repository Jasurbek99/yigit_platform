import { useTranslation } from 'react-i18next';
import { Alert, Button, Popover, Space, Tag, Typography } from 'antd';
import { IconLink, IconScale } from '@tabler/icons-react';

import { CmrDocumentsButton } from '@/components/CmrDocumentsButton';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
import { PacketZipButton } from '@/components/PacketZipButton';
import { TirCarnetButton } from '@/components/TirCarnetButton';
import { setupItems, setupNoticeText } from '@/components/documentSetupNotice';
import { ShipmentFirmContractsPanel } from '@/components/sheet/ShipmentFirmContractsPanel';
import { ShipmentPackingPanel } from '@/components/sheet/ShipmentPackingPanel';
import type { IDocumentPacket } from '@/types';

interface IDocumentPacketPanelProps {
  readonly packet: IDocumentPacket;
  /**
   * On the shipment page every missing field is on the same screen: the
   * notice lists them as links that scroll to the row (by element id)
   * instead of sending the user to the Sheet.
   */
  readonly onJumpTo?: (elementId: string) => void;
}

/**
 * One truck's document packet (the expanded row on the Documents page): a
 * readiness banner listing anything still to fill, the truck-level CMR and TIR
 * carnet, then a row per export firm with that firm's invoice / letters. Both
 * truck-level documents are disabled until the truck is ready (setup + packing
 * done), since each prints the whole-truck box count and weights.
 */
export function DocumentPacketPanel({ packet, onJumpTo }: IDocumentPacketPanelProps) {
  const { t } = useTranslation();
  const items = setupItems(packet.missing_setup, packet.is_gapy_satys);

  return (
    <Space direction="vertical" size="small" style={{ width: '100%', padding: '4px 8px' }}>
      {items.length > 0 && (
        // Show WHAT is missing, so the team understands why the truck isn't
        // document-ready instead of it silently not appearing.
        <Alert
          type="warning"
          showIcon
          message={onJumpTo ? (
            <Space size={4} wrap>
              <span>{t('documents_page.complete_here')}</span>
              {items.map((item) => (
                <Button key={item.key} type="link" size="small" style={{ padding: 0 }}
                  onClick={() => onJumpTo(item.anchor)}>
                  {t(`documents_page.field.${item.key}`)}
                </Button>
              ))}
            </Space>
          ) : setupNoticeText(items, [], t)}
        />
      )}

      <Space wrap>
        <PacketZipButton shipmentId={packet.id} disabled={!packet.is_ready} />
        <Typography.Text strong>{t('documents.cmr')}:</Typography.Text>
        <CmrDocumentsButton shipmentId={packet.id} disabled={!packet.is_ready} />
        <TirCarnetButton shipmentId={packet.id} disabled={!packet.is_ready} />
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
