import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DatePicker, Form, Input, Modal, Segmented } from 'antd';
import type { Dayjs } from 'dayjs';
import { IconFileText } from '@tabler/icons-react';

import { DocumentLayoutPopover } from '@/components/DocumentLayoutPopover';
import { useDocumentDownload } from '@/hooks/useDocumentDownload';

interface IContractAgreementButtonProps {
  readonly contractId: number;
  readonly disabled?: boolean;
  readonly size?: 'small' | 'middle' | 'large';
  // The buyer firm's saved director name — pre-fills the modal's director field
  // (editable). Empty when the firm has none.
  readonly defaultDirector?: string;
  /**
   * Fires when the generator modal opens/closes. Call sites that render this
   * button inside a dismiss-on-outside-click container (the Sheet's contracts
   * cell Popover) use it to hold that container open — the modal is a portal on
   * document.body, so clicking it reads as an outside click and would otherwise
   * unmount the button and its modal together.
   */
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * Generate the bilingual TK/RU export contract (.docx or PDF) for a contract.
 *
 * The contract's number, date, financials, seller and validity come from the DB.
 * The modal pre-fills the buyer's director from the firm's saved "Director's Full
 * Name" (contact_person, editable) and collects the delivery deadline (§2.6), then
 * hits GET /contracts/contracts/{id}/agreement/. The template covers every
 * destination country with a verified genitive form in `_COUNTRY_GENITIVE`
 * (its §4 clauses name that country's authorities); ContractDetail disables the
 * button for the rest, off the `contract_template_supported` flag.
 */
export function ContractAgreementButton({
  contractId,
  disabled = false,
  size = 'middle',
  defaultDirector = '',
  onOpenChange,
}: IContractAgreementButtonProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);

  const [buyerDirector, setBuyerDirector] = useState('');
  const [deadline, setDeadline] = useState<Dayjs | null>(null);
  const [fmt, setFmt] = useState<'docx' | 'pdf'>('docx');
  const [withStamps, setWithStamps] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const { isGenerating, download } = useDocumentDownload();

  // Single write path for the modal's open state, so `onOpenChange` can never
  // drift out of sync with it (three call sites close the modal).
  const setModalOpen = (next: boolean): void => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const handleOpen = (): void => {
    setBuyerDirector(defaultDirector);  // pre-fill from the firm's saved director
    setDeadline(null);
    setFmt('docx');
    setWithStamps(false);
    setHighlight(true);
    setModalOpen(true);
  };

  const handleConfirm = async (): Promise<void> => {
    const params = new URLSearchParams({ fmt });
    if (buyerDirector.trim()) params.set('buyer_director', buyerDirector.trim());
    if (deadline) params.set('delivery_deadline', deadline.format('YYYY-MM-DD'));
    if (withStamps) params.set('stamps', '1');
    // Red is the server default; only the opt-out needs to travel.
    if (!highlight) params.set('highlight', '0');
    // The PDF variant shells out to LibreOffice (slow); the hook keeps the modal
    // open with a spinner so the user can't fire duplicate downloads.
    const ok = await download(
      `/contracts/contracts/${contractId}/agreement/?${params.toString()}`,
    );
    if (ok) setModalOpen(false);
  };

  return (
    <>
      <Button size={size} icon={<IconFileText size={16} />} disabled={disabled} onClick={handleOpen}>
        {t('contracts.generate.button')}
      </Button>

      <Modal
        open={open}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('contracts.generate.title')}
            <DocumentLayoutPopover documentKey="contract_kz" />
          </span>
        }
        onOk={handleConfirm}
        onCancel={() => setModalOpen(false)}
        okText={t('documents.download')}
        confirmLoading={isGenerating}
        maskClosable={!isGenerating}
        cancelButtonProps={{ disabled: isGenerating }}
        closable={!isGenerating}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item
            label={t('contracts.generate.buyer_director')}
            extra={t('contracts.generate.buyer_director_extra')}
          >
            <Input
              value={buyerDirector}
              onChange={(e) => setBuyerDirector(e.target.value)}
              placeholder={t('contracts.generate.buyer_director_ph')}
              allowClear
            />
          </Form.Item>
          <Form.Item label={t('contracts.generate.delivery_deadline')}>
            <DatePicker
              value={deadline}
              onChange={setDeadline}
              format="DD.MM.YYYY"
              style={{ width: '100%' }}
              placeholder={t('contracts.generate.delivery_deadline_ph')}
            />
          </Form.Item>
          <Form.Item label={t('contracts.generate.format')}>
            <Segmented
              value={fmt}
              onChange={(value) => {
                if (value === 'docx' || value === 'pdf') setFmt(value);
              }}
              options={[
                { label: t('documents.word'), value: 'docx' },
                { label: t('documents.pdf'), value: 'pdf' },
              ]}
            />
          </Form.Item>
          <Form.Item extra={t('contracts.generate.with_stamps_extra')}>
            <Checkbox checked={withStamps} onChange={(e) => setWithStamps(e.target.checked)}>
              {t('contracts.generate.with_stamps')}
            </Checkbox>
          </Form.Item>
          <Form.Item extra={t('documents.highlight_extra')}>
            <Checkbox checked={highlight} onChange={(e) => setHighlight(e.target.checked)}>
              {t('documents.highlight')}
            </Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
