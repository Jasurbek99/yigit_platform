import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { IconFileText } from '@tabler/icons-react';

import {
  DocumentOptionsModal,
  applyDocumentOptions,
  type IDocumentOptions,
} from '@/components/DocumentOptionsModal';
import { useDocumentDownload } from '@/hooks/useDocumentDownload';

interface ICmrDocumentsButtonProps {
  readonly shipmentId: number;
  readonly disabled?: boolean;
  readonly size?: 'small' | 'middle' | 'large';
}

const VARIANTS = [
  { lang: 'ru', badge: 'RU' },
  { lang: 'en', badge: 'EN' },
] as const;

// The CMR prints onto the pre-printed customs form. Word is the office's own
// form and is the default; PDF is converted from it and is the slow path
// (LibreOffice). Excel serves the separate spreadsheet print-overlay, whose
// geometry predates the Word rebuild — check one printed sample against the
// pre-printed form before relying on it.
const FORMATS = ['docx', 'pdf', 'xlsx'] as const;
const FMT_LABEL_KEY: Record<(typeof FORMATS)[number], string> = {
  docx: 'word',
  pdf: 'pdf',
  xlsx: 'excel',
};

/**
 * Truck-level CMR download — one CMR per shipment, all export firms listed as
 * senders. Opens a modal to pick the loading point and (Uzbekistan transit) the
 * TIR carnet №, then hits GET /contracts/shipments/{id}/cmr/.
 */
export function CmrDocumentsButton({
  shipmentId,
  disabled = false,
  size = 'small',
}: ICmrDocumentsButtonProps) {
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
      `/contracts/shipments/${shipmentId}/cmr/?${params.toString()}`,
    );
    if (ok) setPending(null);
  };

  return (
    <>
      <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']} disabled={disabled}>
        <Button size={size} icon={<IconFileText size={16} />} disabled={disabled}>
          {t('documents.cmr')}
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
