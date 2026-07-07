import { useTranslation } from 'react-i18next';
import { Space, Tag, Typography } from 'antd';

import { CmrDocumentsButton } from '@/components/CmrDocumentsButton';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
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
            <Typography.Text type="secondary">
              {t('documents_page.no_contract')}
            </Typography.Text>
          )}
        </Space>
      ))}
    </Space>
  );
}
