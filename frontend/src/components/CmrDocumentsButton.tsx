import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Form, Input, Modal, Select } from 'antd';
import type { MenuProps } from 'antd';
import { IconFileText } from '@tabler/icons-react';
import { toast } from 'sonner';

import { useLoadingLocations } from '@/hooks/useAdmin';
import { downloadFile } from '@/utils/fileDownload';

interface ICmrDocumentsButtonProps {
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
  const { data: loadingLocations = [] } = useLoadingLocations();

  const [pending, setPending] = useState<{ lang: string; fmt: string } | null>(null);
  const [placeLoading, setPlaceLoading] = useState<string | undefined>(undefined);
  const [tirCarnet, setTirCarnet] = useState('');

  const items: MenuProps['items'] = VARIANTS.flatMap((variant) =>
    FORMATS.map((fmt) => ({
      key: `${variant.lang}|${fmt}`,
      label: `${t(`documents.${FMT_LABEL_KEY[fmt]}`)} · ${variant.badge}`,
    })),
  );

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    const [lang, fmt] = key.split('|');
    setPlaceLoading(undefined);
    setTirCarnet('');
    setPending({ lang, fmt });
  };

  const handleConfirm = (): void => {
    if (!pending) return;
    const params = new URLSearchParams({ lang: pending.lang, fmt: pending.fmt });
    if (placeLoading) params.set('place_loading', placeLoading);
    if (tirCarnet.trim()) params.set('tir_carnet', tirCarnet.trim());
    void downloadFile(`/contracts/shipments/${shipmentId}/cmr/?${params.toString()}`).catch(
      (error) => toast.error(error instanceof Error ? error.message : t('documents.download_failed')),
    );
    setPending(null);
  };

  return (
    <>
      <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']} disabled={disabled}>
        <Button size={size} icon={<IconFileText size={16} />} disabled={disabled}>
          {t('documents.cmr')}
        </Button>
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
          <Form.Item label={t('documents.tir_carnet')}>
            <Input
              value={tirCarnet}
              onChange={(e) => setTirCarnet(e.target.value)}
              placeholder={t('documents.tir_carnet_ph')}
              allowClear
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
