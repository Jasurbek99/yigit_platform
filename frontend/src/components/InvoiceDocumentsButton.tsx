import { useTranslation } from 'react-i18next';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { IconFileText } from '@tabler/icons-react';

import { downloadUrl } from '@/utils/fileDownload';

interface IInvoiceDocumentsButtonProps {
  readonly invoiceId: number;
  readonly size?: 'small' | 'middle' | 'large';
}

interface IDocFamily {
  readonly labelKey: string;
  readonly base: string; // registry key prefix, e.g. 'invoice' → invoice_ru / invoice_en
}

const DOC_FAMILIES: readonly IDocFamily[] = [
  { labelKey: 'documents.invoice', base: 'invoice' },
  { labelKey: 'documents.cmr', base: 'cmr' },
];

const LANGS = ['ru', 'en'] as const;
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
    children: LANGS.flatMap((lang) =>
      FORMATS.map((fmt) => ({
        key: `${family.base}_${lang}|${fmt}`,
        label: `${t(`documents.${fmt}`)} · ${lang.toUpperCase()}`,
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
