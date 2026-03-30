import { useState } from 'react';
import { Button, Modal, Input, Select, Space, Typography } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';

// Maps status code → display name (mirrors seed_data STATUS_TYPES)
const STATUS_DISPLAY: Record<string, string> = {
  yuklenme: 'Loading',
  gumruk_girish: 'Customs Entry',
  gumruk_chykysh: 'Customs Exit',
  yola_chykdy: 'Departed',
  serhet_tm: 'TM Border',
  serhet_gechdi: 'Border Crossed',
  barysh_gumrugi: 'Dest Customs',
  yolda: 'In Transit',
  bardy: 'Arrived',
  satylyar: 'Being Sold',
  satyldy: 'Sold',
  hasabat: 'Report',
  tamamlandy: 'Completed',
};

interface ITransitionButtonProps {
  shipmentId: number;
  allowedTransitions: string[];
  onSuccess?: () => void;
}

export function TransitionButton({ shipmentId, allowedTransitions, onSuccess }: ITransitionButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | undefined>(undefined);
  const [comment, setComment] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (allowedTransitions.length === 0) return null;

  const options = allowedTransitions.map((code) => ({
    value: code,
    label: STATUS_DISPLAY[code] ?? code,
  }));

  function handleOpen() {
    setSelectedCode(allowedTransitions.length === 1 ? allowedTransitions[0] : undefined);
    setComment('');
    setOpen(true);
  }

  async function handleConfirm() {
    if (!selectedCode) return;
    setIsLoading(true);
    try {
      await api.post(`/export/shipments/${shipmentId}/transition/`, {
        new_status: selectedCode,
        comment: comment.trim() || undefined,
      });
      toast.success(t('transition.toast_success', { status: STATUS_DISPLAY[selectedCode] ?? selectedCode }));
      await queryClient.invalidateQueries({ queryKey: ['shipment', String(shipmentId)] });
      setOpen(false);
      onSuccess?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(t('transition.toast_error'), { description: msg ?? t('transition.toast_error_desc') });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <Button type="primary" icon={<SwapOutlined />} onClick={handleOpen}>
        {t('transition.button')}
      </Button>

      <Modal
        title={t('transition.modal_title')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleConfirm}
        okText={t('transition.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ loading: isLoading, disabled: !selectedCode }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Typography.Text strong>{t('transition.new_status')}</Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 6 }}
              placeholder={t('transition.select_status')}
              options={options}
              value={selectedCode}
              onChange={setSelectedCode}
            />
          </div>
          <div>
            <Typography.Text strong>{t('transition.comment_label')}</Typography.Text>
            <Input.TextArea
              style={{ marginTop: 6 }}
              rows={3}
              placeholder={t('transition.comment_placeholder')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}
