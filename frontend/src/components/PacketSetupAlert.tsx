import { useTranslation } from 'react-i18next';
import { Alert, Button, Space } from 'antd';

import { setupItems, setupNoticeText } from '@/components/documentSetupNotice';
import type { IDocumentPacket } from '@/types';

interface IPacketSetupAlertProps {
  readonly packet: IDocumentPacket;
  /**
   * On the shipment page every missing field is on the same screen: the
   * notice lists them as links that scroll to the row (by element id)
   * instead of sending the user to the Sheet.
   */
  readonly onJumpTo?: (elementId: string) => void;
}

/** What the truck still needs before its documents generate; nothing when ready. */
export function PacketSetupAlert({ packet, onJumpTo }: IPacketSetupAlertProps) {
  const { t } = useTranslation();
  const items = setupItems(packet.missing_setup, packet.is_gapy_satys);
  if (items.length === 0) return null;

  return (
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
  );
}
