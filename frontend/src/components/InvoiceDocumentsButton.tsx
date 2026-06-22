import { useTranslation } from 'react-i18next';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { IconFileText } from '@tabler/icons-react';

import { downloadUrl } from '@/utils/fileDownload';

interface IInvoiceDocumentsButtonProps {
  readonly invoiceId: number;
  readonly size?: 'small' | 'middle' | 'large';
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
const DOC_FAMILIES: readonly IDocFamily[] = [
  { labelKey: 'documents.invoice', variants: [{ type: 'invoice_ru', lang: 'RU' }, { type: 'invoice_en', lang: 'EN' }] },
  { labelKey: 'documents.cmr', variants: [{ type: 'cmr_ru', lang: 'RU' }, { type: 'cmr_en', lang: 'EN' }] },
  { labelKey: 'documents.ct1', variants: [{ type: 'ct1_ru', lang: 'RU' }] },
  { labelKey: 'documents.fito', variants: [{ type: 'fito_ru', lang: 'RU' }] },
  { labelKey: 'documents.customs', variants: [{ type: 'customs_tk', lang: 'TK' }] },
];

const FORMATS = ['docx', 'pdf'] as const;

/**
 * Per-invoice "Documents" dropdown — generates Invoice / CMR in RU/EN as
 * Word (.docx) or PDF, hitting GET /contracts/invoices/{id}/document/.
 */
export function InvoiceDocumentsButton({
  invoiceId,
  size = 'small',
}: IInvoiceDocumentsButtonProps) {
  const { t } = useTranslation();

  const items: MenuProps['items'] = DOC_FAMILIES.map((family) => ({
    type: 'group' as const,
    label: t(family.labelKey),
    children: family.variants.flatMap((variant) =>
      FORMATS.map((fmt) => ({
        key: `${variant.type}|${fmt}`,
        label: `${t(`documents.${fmt}`)} · ${variant.lang}`,
      })),
    ),
  }));

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    const [type, fmt] = key.split('|');
    downloadUrl(
      `/api/v1/contracts/invoices/${invoiceId}/document/?type=${type}&fmt=${fmt}`,
    );
  };

  return (
    <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']}>
      <Button
        type="text"
        size={size}
        icon={<IconFileText size={16} />}
        title={t('documents.button')}
      />
    </Dropdown>
  );
}
