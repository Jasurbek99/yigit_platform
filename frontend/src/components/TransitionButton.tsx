import { useState } from 'react';
import { Button, Modal, Form, Select, Input } from 'antd';
import { IconArrowsExchange } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';

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
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [form] = Form.useForm<{ new_status: string; comment?: string }>();

  if (allowedTransitions.length === 0) return null;

  const selectOptions = allowedTransitions.map((code) => ({
    value: code,
    label: STATUS_DISPLAY[code] ?? code,
  }));

  function handleOpen() {
    form.setFieldsValue({
      new_status: allowedTransitions.length === 1 ? allowedTransitions[0] : undefined,
      comment: '',
    });
    setIsOpen(true);
  }

  async function handleConfirm() {
    const values = await form.validateFields();
    setIsLoading(true);
    try {
      await api.post(`/export/shipments/${shipmentId}/transition/`, {
        new_status: values.new_status,
        comment: values.comment?.trim() || undefined,
      });
      toast.success(t('transition.toast_success', { status: STATUS_DISPLAY[values.new_status] ?? values.new_status }));
      await queryClient.invalidateQueries({ queryKey: ['shipment', String(shipmentId)] });
      setIsOpen(false);
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
      <Button
        type="primary"
        icon={<IconArrowsExchange size={14} />}
        onClick={handleOpen}
      >
        {t('transition.button')}
      </Button>

      <Modal
        open={isOpen}
        title={t('transition.modal_title')}
        onCancel={() => setIsOpen(false)}
        onOk={() => void handleConfirm()}
        okText={t('transition.confirm')}
        cancelText={t('common.cancel')}
        confirmLoading={isLoading}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="new_status"
            label={t('transition.new_status')}
            rules={[{ required: true, message: t('transition.select_status') }]}
          >
            <Select options={selectOptions} placeholder={t('transition.select_status')} />
          </Form.Item>
          <Form.Item name="comment" label={t('transition.comment_label')}>
            <Input.TextArea rows={3} placeholder={t('transition.comment_placeholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
