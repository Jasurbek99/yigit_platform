import { Alert, Button, Popover, Space, Spin, Tag } from 'antd';
import { IconLink } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { CmrDocumentsButton } from '@/components/CmrDocumentsButton';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
import { TirCarnetButton } from '@/components/TirCarnetButton';
import { ShipmentFirmContractsPanel } from '@/components/sheet/ShipmentFirmContractsPanel';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import { setupItems, setupNoticeText } from '@/components/documentSetupNotice';

type DocKind = 'cmr' | 'tir' | 'letters';

/** Which document(s) each PREP/DOCS task prints. Downloading through these
 * dialogs closes the print task server-side (spec 2026-09-30 §3). */
const TASK_DOCUMENTS: Record<string, readonly DocKind[]> = {
  'tasks.prepare_transport_docs': ['cmr', 'tir'],
  'tasks.print_cmr': ['cmr'],
  'tasks.print_tir': ['tir'],
  'tasks.print_ct1': ['letters'],
  'tasks.print_phyto': ['letters'],
  'tasks.print_customs_request': ['letters'],
};

/** True for a task whose card carries document dialogs (mount only then). */
export function hasTaskDocuments(titleKey: string): boolean {
  return titleKey in TASK_DOCUMENTS;
}

/** The authority letter each letter task prints, per firm's sale. */
const LETTER_TYPE: Record<string, string> = {
  'tasks.print_ct1': 'ct1_ru',
  'tasks.print_phyto': 'fito_ru',
  'tasks.print_customs_request': 'customs_tk',
};

interface ITaskDocumentButtonsProps {
  titleKey: string;
  shipmentId: number;
}

/**
 * The same document dialogs as the Documents page, on the task card, so a
 * print task is printed (and previewed as PDF) from where it is assigned —
 * not only marked with «Çap etdim». Owner 2026-09-30.
 */
export function TaskDocumentButtons({ titleKey, shipmentId }: ITaskDocumentButtonsProps) {
  const { t } = useTranslation();
  const kinds = TASK_DOCUMENTS[titleKey];
  const { data: packet, isLoading } = useShipmentDocumentPacket(kinds ? shipmentId : null);

  if (!kinds) return null;
  if (isLoading) return <Spin size="small" />;
  if (!packet) return null;

  const items = setupItems(packet.missing_setup, packet.is_gapy_satys);
  const packingLabels = packet.packing_complete ? [] : [t('tasks.field_label.packing_template')];

  return (
    <Space direction="vertical" size="small" style={{ width: '100%', marginTop: 8 }}>
      {!packet.is_ready && (items.length > 0 || packingLabels.length > 0) && (
        <Alert type="warning" showIcon message={setupNoticeText(items, packingLabels, t)} />
      )}
      <Space wrap>
        {kinds.includes('cmr') && (
          <CmrDocumentsButton shipmentId={shipmentId} disabled={!packet.is_ready} size="small" />
        )}
        {kinds.includes('tir') && (
          <TirCarnetButton shipmentId={shipmentId} disabled={!packet.is_ready} size="small" />
        )}
      </Space>
      {kinds.includes('letters') &&
        packet.firms.map((firm) => (
          <Space key={firm.export_firm_id} wrap>
            <Tag>{firm.export_firm_name}</Tag>
            {firm.sale_id !== null ? (
              <InvoiceDocumentsButton invoiceId={firm.sale_id} size="small" docType={LETTER_TYPE[titleKey]} />
            ) : (
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
            )}
          </Space>
        ))}
    </Space>
  );
}
