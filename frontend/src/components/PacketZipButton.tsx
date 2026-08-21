import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { IconPackage } from '@tabler/icons-react';

import {
  DocumentOptionsModal,
  applyDocumentOptions,
  type IDocumentOptions,
} from '@/components/DocumentOptionsModal';
import { useDocumentDownload } from '@/hooks/useDocumentDownload';

interface IPacketZipButtonProps {
  readonly shipmentId: number;
  readonly disabled?: boolean;
  readonly size?: 'small' | 'middle' | 'large';
}

const VARIANTS = [
  { lang: 'ru', badge: 'RU' },
  { lang: 'en', badge: 'EN' },
] as const;

const FORMATS = ['docx', 'pdf'] as const;
// docx uses the 'word' i18n key; pdf uses 'pdf'.
const FMT_LABEL_KEY: Record<(typeof FORMATS)[number], string> = { docx: 'word', pdf: 'pdf' };

/**
 * Whole-packet download — one zip with the truck CMR + every firm's invoice and
 * request letters. Opens the same loading-point / TIR-carnet modal as the CMR
 * (the packet contains a CMR), then hits GET /contracts/shipments/{id}/packet.zip.
 */
export function PacketZipButton({
  shipmentId,
  disabled = false,
  size = 'small',
}: IPacketZipButtonProps) {
  const { t } = useTranslation();
  const { isGenerating, download } = useDocumentDownload();

  const [pending, setPending] = useState<{ lang: string; fmt: string } | null>(null);

  const items: MenuProps['items'] = VARIANTS.flatMap((variant) =>
    FORMATS.map((fmt) => ({
      key: `${variant.lang}|${fmt}`,
      label: `${t(`documents.${FMT_LABEL_KEY[fmt]}`)} · ${variant.badge}`,
    })),
  );

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    const [lang, fmt] = key.split('|');
    setPending({ lang, fmt });
  };

  const handleConfirm = async (options: IDocumentOptions): Promise<void> => {
    if (!pending) return;
    const params = new URLSearchParams({ lang: pending.lang, fmt: pending.fmt });
    applyDocumentOptions(params, options);
    const ok = await download(
      `/contracts/shipments/${shipmentId}/packet.zip?${params.toString()}`,
    );
    if (ok) setPending(null);
  };

  return (
    <>
      <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']} disabled={disabled}>
        <Button size={size} type="primary" icon={<IconPackage size={16} />} disabled={disabled}>
          {t('documents_page.download_packet')}
        </Button>
      </Dropdown>

      <DocumentOptionsModal
        open={pending !== null}
        isGenerating={isGenerating}
        withTirCarnet
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
