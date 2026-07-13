import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DatePicker, Form, Input, Modal, Segmented } from 'antd';
import type { Dayjs } from 'dayjs';
import { IconFileText } from '@tabler/icons-react';
import { toast } from 'sonner';

import { downloadFile } from '@/utils/fileDownload';

interface IContractAgreementButtonProps {
  readonly contractId: number;
  readonly disabled?: boolean;
  readonly size?: 'small' | 'middle' | 'large';
  // The buyer firm's saved director name — pre-fills the modal's director field
  // (editable). Empty when the firm has none.
  readonly defaultDirector?: string;
}

/**
 * Generate the bilingual TK/RU export contract (.docx or PDF) for a contract.
 *
 * The contract's number, date, financials, seller and validity come from the DB;
 * the modal collects the two fields the model does not store — the buyer's
 * director name and the delivery deadline (§2.6) — then hits
 * GET /contracts/contracts/{id}/agreement/. This template is Kazakhstan-specific
 * (its clauses reference KZ customs authorities).
 */
export function ContractAgreementButton({
  contractId,
  disabled = false,
  size = 'middle',
  defaultDirector = '',
}: IContractAgreementButtonProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [buyerDirector, setBuyerDirector] = useState('');
  const [deadline, setDeadline] = useState<Dayjs | null>(null);
  const [fmt, setFmt] = useState<'docx' | 'pdf'>('docx');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleOpen = (): void => {
    setBuyerDirector(defaultDirector);  // pre-fill from the firm's saved director
    setDeadline(null);
    setFmt('docx');
    setOpen(true);
  };

  const handleConfirm = async (): Promise<void> => {
    const params = new URLSearchParams({ fmt });
    if (buyerDirector.trim()) params.set('buyer_director', buyerDirector.trim());
    if (deadline) params.set('delivery_deadline', deadline.format('YYYY-MM-DD'));
    setIsGenerating(true);
    try {
      // The PDF variant shells out to LibreOffice (slow); keep the modal open with
      // a spinner so the user can't fire duplicate downloads.
      await downloadFile(`/contracts/contracts/${contractId}/agreement/?${params.toString()}`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('documents.download_failed'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <Button size={size} icon={<IconFileText size={16} />} disabled={disabled} onClick={handleOpen}>
        {t('contracts.generate.button')}
      </Button>

      <Modal
        open={open}
        title={t('contracts.generate.title')}
        onOk={handleConfirm}
        onCancel={() => setOpen(false)}
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
        </Form>
      </Modal>
    </>
  );
}
