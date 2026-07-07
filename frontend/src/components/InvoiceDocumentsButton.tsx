import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Form, Modal, Select } from 'antd';
import type { MenuProps } from 'antd';
import { IconFileText } from '@tabler/icons-react';
import { toast } from 'sonner';

import { useLoadingLocations } from '@/hooks/useAdmin';
import { downloadFile } from '@/utils/fileDownload';

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
 * Customs documents, hitting GET /contracts/sales/{id}/document/. Invoice first
 * opens a small modal to pick the loading point; the letters download immediately.
 */
export function InvoiceDocumentsButton({
  invoiceId,
  size = 'small',
}: IInvoiceDocumentsButtonProps) {
  const { t } = useTranslation();
  const { data: loadingLocations = [] } = useLoadingLocations();

  const [pending, setPending] = useState<{ type: string; fmt: string } | null>(null);
  const [placeLoading, setPlaceLoading] = useState<string | undefined>(undefined);

  const download = async (
    type: string, fmt: string, overrides?: Record<string, string>,
  ): Promise<void> => {
    const params = new URLSearchParams({ type, fmt, ...overrides });
    try {
      await downloadFile(`/contracts/sales/${invoiceId}/document/?${params.toString()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('documents.download_failed'));
    }
  };

  const items: MenuProps['items'] = DOC_FAMILIES.map((family) => ({
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
    if (takesLoading(type)) {
      setPlaceLoading(undefined);
      setPending({ type, fmt });
      return;
    }
    void download(type, fmt);
  };

  const handleConfirm = (): void => {
    if (!pending) return;
    const overrides: Record<string, string> = {};
    if (placeLoading) overrides.place_loading = placeLoading;
    void download(pending.type, pending.fmt, overrides);
    setPending(null);
  };

  return (
    <>
      <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']}>
        <Button
          type="text"
          size={size}
          icon={<IconFileText size={16} />}
          title={t('documents.button')}
        />
      </Dropdown>

      <Modal
        open={pending !== null}
        title={t('documents.options_title')}
        onOk={handleConfirm}
        onCancel={() => setPending(null)}
        okText={t('documents.download')}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label={t('documents.place_loading')}>
            <Select
              value={placeLoading}
              onChange={setPlaceLoading}
              options={loadingLocations.map((loc) => ({ value: loc.name, label: loc.name }))}
              placeholder={t('documents.place_loading_ph')}
              allowClear
              showSearch
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
