import { useEffect } from 'react';
import { Modal, Form, DatePicker } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IGrantExtensionFormValues {
  granted_until: Dayjs | null;
}

export interface IGrantExtensionModalProps {
  open: boolean;
  isSubmitting: boolean;
  onConfirm: (granted_until: string) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GrantExtensionModal({
  open,
  isSubmitting,
  onConfirm,
  onClose,
}: IGrantExtensionModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [form] = Form.useForm<IGrantExtensionFormValues>();

  // Reset form each time the modal is opened
  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  function handleOk() {
    form.validateFields().then((values) => {
      if (!values.granted_until) return;
      onConfirm(values.granted_until.toISOString());
    });
  }

  return (
    <Modal
      open={open}
      title={t('plan.bulk_modal_title')}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ loading: isSubmitting }}
      onOk={handleOk}
      onCancel={onClose}
      destroyOnHidden
      width={440}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="granted_until"
          label={t('plan.granted_until')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <DatePicker
            showTime={{ format: 'HH:mm' }}
            format="YYYY-MM-DD HH:mm"
            disabledDate={(current) => current && current.isBefore(dayjs(), 'minute')}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
