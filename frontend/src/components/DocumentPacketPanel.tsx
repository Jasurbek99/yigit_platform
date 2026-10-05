import { useTranslation } from 'react-i18next';
import { Space, Tag, Typography } from 'antd';

import { CmrDocumentsButton } from '@/components/CmrDocumentsButton';
import { FillPackingButton } from '@/components/FillPackingButton';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
import { LinkContractButton } from '@/components/LinkContractButton';
import { PacketSetupAlert } from '@/components/PacketSetupAlert';
import { PacketZipButton } from '@/components/PacketZipButton';
import { TirCarnetButton } from '@/components/TirCarnetButton';
import type { IDocumentPacket } from '@/types';

interface IDocumentPacketPanelProps {
  readonly packet: IDocumentPacket;
  /** Missing-field links scroll to rows on the same page (see PacketSetupAlert). */
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

  return (
    <Space direction="vertical" size="small" style={{ width: '100%', padding: '4px 8px' }}>
      <PacketSetupAlert packet={packet} onJumpTo={onJumpTo} />

      <Space wrap>
        <PacketZipButton shipmentId={packet.id} disabled={!packet.is_ready} />
        <Typography.Text strong>{t('documents.cmr')}:</Typography.Text>
        <CmrDocumentsButton shipmentId={packet.id} disabled={!packet.is_ready} />
        <TirCarnetButton shipmentId={packet.id} disabled={!packet.is_ready} />
        {!packet.packing_complete && <FillPackingButton shipmentId={packet.id} />}
      </Space>

      {packet.firms.map((firm) => (
        <Space key={firm.export_firm_id} wrap>
          <Tag>{firm.export_firm_name}</Tag>
          {firm.sale_id !== null ? (
            <InvoiceDocumentsButton invoiceId={firm.sale_id} size="small" />
          ) : (
            <LinkContractButton shipmentId={packet.id} />
          )}
        </Space>
      ))}
    </Space>
  );
}
