import { useEffect } from 'react';
import { Form, Input, InputNumber, Switch, Modal } from 'antd';
import type { FormInstance } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ISplitTemplate } from '@/types/splitTemplate';

export interface ISplitTemplateFormValues {
  name: string;
  weights: string;
  is_active: boolean;
  sort_order: number;
}

interface ISplitTemplateModalProps {
  open: boolean;
  editTarget: ISplitTemplate | null;
  confirmLoading: boolean;
  onOk: () => void;
  onCancel: () => void;
  onFinish: (values: ISplitTemplateFormValues) => void;
  form: FormInstance<ISplitTemplateFormValues>;
}

export function SplitTemplateModal({
  open, editTarget, confirmLoading, onOk, onCancel, onFinish, form,
}: ISplitTemplateModalProps): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      form.setFieldsValue({
        name: editTarget.name,
        weights: editTarget.weights,
        is_active: editTarget.is_active,
        sort_order: editTarget.sort_order,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true, sort_order: 10 });
    }
  }, [open, editTarget, form]);

  const isEdit = editTarget !== null;

  return (
    <Modal
      title={isEdit ? t('split_template.modal_edit') : t('split_template.modal_create')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      destroyOnHidden
      width={460}
    >
      <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 8 }}>
        <Form.Item
          name="name"
          label={t('split_template.col_name')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input placeholder="10000 / 8000" />
        </Form.Item>

        <Form.Item
          name="weights"
          label={t('split_template.col_weights')}
          extra={t('split_template.weights_hint')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input placeholder="10000,8000" />
        </Form.Item>

        <Form.Item name="sort_order" label={t('split_template.col_sort_order')}>
          <InputNumber min={0} precision={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="is_active" label={t('split_template.col_status')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
