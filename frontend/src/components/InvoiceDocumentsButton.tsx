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

interface IInvoiceDocumentsButtonProps {
  readonly invoiceId: number;
  readonly size?: 'small' | 'middle' | 'large';
  /** One document only (e.g. 'ct1_ru' on the «Print CT-1» task card): a
   * labelled button whose menu holds just that document's formats. */
  readonly docType?: string;
}

interface IDocVariant {
  readonly type: string; // registry key, e.g. 'invoice_ru', 'customs_tk'
  readonly lang: string; // display badge: 'RU' | 'EN' | 'TK'
}

interface IDocFamily {
  readonly labelKey: string;
  readonly variants: readonly IDocVariant[];
}

// One group per document family; some are single-language per the source forms.
// The CMR is truck-level (per shipment), not per-firm, so it lives on the
// Documents page — not in this per-sale dropdown.
const DOC_FAMILIES: readonly IDocFamily[] = [
  { labelKey: 'documents.invoice', variants: [{ type: 'invoice_ru', lang: 'RU' }, { type: 'invoice_en', lang: 'EN' }] },
  { labelKey: 'documents.ct1', variants: [{ type: 'ct1_ru', lang: 'RU' }] },
  { labelKey: 'documents.fito', variants: [{ type: 'fito_ru', lang: 'RU' }] },
  { labelKey: 'documents.customs', variants: [{ type: 'customs_tk', lang: 'TK' }] },
];

const FORMATS = ['docx', 'pdf'] as const;
// docx uses the 'word' i18n key; pdf uses 'pdf'.
const FMT_LABEL_KEY: Record<(typeof FORMATS)[number], string> = { docx: 'word', pdf: 'pdf' };

// The invoice takes a generate-time loading point; the letters take no inputs.
const takesLoading = (type: string): boolean => type.startsWith('invoice');

/**
 * Per-sale "Documents" dropdown — generates the per-firm Invoice / CT-1 / FITO /
 * Customs documents, hitting GET /contracts/sales/{id}/document/.
 *
 * Every type opens the options modal. The letters take no loading point, so
 * theirs shows only the red-highlight toggle — they still need it, since these
 * are the copies that go to the customs and phytosanitary authorities.
 */
export function InvoiceDocumentsButton({
  invoiceId,
  size = 'small',
  docType,
}: IInvoiceDocumentsButtonProps) {
  const { t } = useTranslation();
  const { isGenerating, download } = useDocumentDownload();

  const [pending, setPending] = useState<{ type: string; fmt: string } | null>(null);

  const families = docType
    ? DOC_FAMILIES
        .map((family) => ({ ...family, variants: family.variants.filter((v) => v.type === docType) }))
        .filter((family) => family.variants.length > 0)
    : DOC_FAMILIES;

  const items: MenuProps['items'] = families.map((family) => ({
    type: 'group' as const,
    label: t(family.labelKey),
    children: family.variants.flatMap((variant) =>
      FORMATS.map((fmt) => ({
        key: `${variant.type}|${fmt}`,
        label: `${t(`documents.${FMT_LABEL_KEY[fmt]}`)} · ${variant.lang}`,
      })),
    ),
  }));

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    const [type, fmt] = key.split('|');
    setPending({ type, fmt });
  };

  const handleConfirm = async (options: IDocumentOptions): Promise<void> => {
    if (!pending) return;
    const params = new URLSearchParams({ type: pending.type, fmt: pending.fmt });
    applyDocumentOptions(params, options);
    const ok = await download(
      `/contracts/sales/${invoiceId}/document/?${params.toString()}`,
    );
    if (ok) setPending(null);
  };

  return (
    <>
      <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']}>
        {docType && families.length > 0 ? (
          <Button size={size} icon={<IconFileText size={16} />}>
            {t(families[0].labelKey)}
          </Button>
        ) : (
          <Button
            type="text"
            size={size}
            icon={<IconFileText size={16} />}
            title={t('documents.button')}
          />
        )}
      </Dropdown>

      <DocumentOptionsModal
        open={pending !== null}
        isGenerating={isGenerating}
        withPlaceLoading={pending !== null && takesLoading(pending.type)}
        documentKey={pending?.type}
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
