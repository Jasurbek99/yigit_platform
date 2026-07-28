import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Form, Input, Modal, Select } from 'antd';
import type { MenuProps } from 'antd';
import { IconPackage } from '@tabler/icons-react';
import { toast } from 'sonner';

import { useLoadingLocations } from '@/hooks/useAdmin';
import { downloadFile } from '@/utils/fileDownload';

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
  const { data: loadingLocations = [] } = useLoadingLocations();

  const [pending, setPending] = useState<{ lang: string; fmt: string } | null>(null);
  const [placeLoading, setPlaceLoading] = useState<string | undefined>(undefined);
  const [tirCarnet, setTirCarnet] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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

  const handleConfirm = async (): Promise<void> => {
    if (!pending) return;
    const params = new URLSearchParams({ lang: pending.lang, fmt: pending.fmt });
    if (placeLoading) params.set('place_loading', placeLoading);
    if (tirCarnet.trim()) params.set('tir_carnet', tirCarnet.trim());
    setIsGenerating(true);
    try {
      // The whole packet re-renders every document, and the PDF path shells out to
      // LibreOffice per file — keep the modal open with a spinner meanwhile.
      await downloadFile(`/contracts/shipments/${shipmentId}/packet.zip?${params.toString()}`);
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('documents.download_failed'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']} disabled={disabled}>
        <Button size={size} type="primary" icon={<IconPackage size={16} />} disabled={disabled}>
          {t('documents_page.download_packet')}
        </Button>
      </Dropdown>

      <Modal
        open={pending !== null}
        title={t('documents.options_title')}
        onOk={handleConfirm}
        onCancel={() => setPending(null)}
        okText={t('documents.download')}
        confirmLoading={isGenerating}
        maskClosable={!isGenerating}
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
