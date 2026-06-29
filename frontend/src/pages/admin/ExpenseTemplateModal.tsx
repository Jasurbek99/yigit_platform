import { useEffect } from 'react';
import { Form, Input, InputNumber, Switch, Modal, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IExpenseCategory } from '@/types';

const { Text } = Typography;

interface IExpenseCategoryFormValues {
  code: string;
  name_tk: string;
  name_ru: string;
  name_en: string;
  logo_code?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

interface IExpenseTemplateModalProps {
  open: boolean;
  editTarget: IExpenseCategory | null;
  confirmLoading: boolean;
  onOk: () => void;
  onCancel: () => void;
  onFinish: (values: IExpenseCategoryFormValues) => void;
  form: FormInstance<IExpenseCategoryFormValues>;
}

export type { IExpenseCategoryFormValues };

export function ExpenseTemplateModal({
  open,
  editTarget,
  confirmLoading,
  onOk,
  onCancel,
  onFinish,
  form,
}: IExpenseTemplateModalProps): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      form.setFieldsValue({
        code: editTarget.code,
        name_tk: editTarget.name_tk,
        name_ru: editTarget.name_ru ?? '',
        name_en: editTarget.name_en ?? '',
        logo_code: editTarget.logo_code ?? '',
        sort_order: editTarget.sort_order,
        is_active: editTarget.is_active,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true, sort_order: 10 });
    }
  }, [open, editTarget, form]);

  const isEdit = editTarget !== null;
  const title = isEdit
    ? t('expense_template.modal_edit')
    : t('expense_template.modal_create');

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="code"
          label={t('expense_template.col_code')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input disabled={isEdit} placeholder={t('expense_template.code_placeholder')} />
        </Form.Item>

        <Form.Item
          name="name_tk"
          label={t('expense_template.col_name_tk')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="name_ru"
          label={t('expense_template.col_name_ru')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="name_en"
          label={t('expense_template.col_name_en')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="logo_code"
          label={t('expense_template.col_logo_code')}
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('expense_template.logo_code_hint')}
            </Text>
          }
        >
          <Input placeholder={t('expense_template.logo_code_placeholder')} />
        </Form.Item>

        <Form.Item name="sort_order" label={t('expense_template.col_sort_order')}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="is_active"
          label={t('expense_template.col_status')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
