import { Form, Input, Modal } from 'antd';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useCreateCustomSheetRow } from '@/hooks/useSheetRowSettings';

// Extracted from SheetRowsTab.tsx when the tab moved to a list + detail
// layout — the modal is unchanged.

interface ICustomRowModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal that asks the admin for a slug + 3-language label, then POSTs to
 * the create-custom-row endpoint. The `custom_` prefix is shown explicitly
 * so two admins don't accidentally collide on names — the uniqueness check
 * happens server-side and the error surfaces in the toast.
 */
export function CustomRowModal({ open, onClose }: ICustomRowModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{
    slug: string;
    label_en: string;
    label_ru?: string;
    label_tk?: string;
  }>();
  const createMutation = useCreateCustomSheetRow();

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const fieldKey = `custom_${values.slug.trim()}`;
      createMutation.mutate(
        {
          field_key: fieldKey,
          label_en: values.label_en.trim(),
          label_ru: values.label_ru?.trim() || undefined,
          label_tk: values.label_tk?.trim() || undefined,
        },
        {
          onSuccess: () => {
            toast.success(t('sheet_rows.custom_created', { field_key: fieldKey }));
            form.resetFields();
            onClose();
          },
          onError: (err) => {
            const apiMsg = err?.response?.data?.error;
            toast.error(apiMsg ?? t('sheet_rows.custom_create_error'));
          },
        },
      );
    } catch {
      // form validation error — antd already highlights the fields
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={handleSubmit}
      okText={t('sheet_rows.custom_modal_ok')}
      title={t('sheet_rows.custom_modal_title')}
      confirmLoading={createMutation.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label={t('sheet_rows.custom_slug_label')}
          name="slug"
          rules={[
            { required: true, message: t('sheet_rows.custom_slug_required') },
            {
              pattern: /^[a-z0-9_]{1,53}$/,
              message: t('sheet_rows.custom_slug_invalid'),
            },
          ]}
          extra={t('sheet_rows.custom_slug_hint')}
        >
          <Input addonBefore="custom_" placeholder={t('sheet_rows.placeholder_field_key')} />
        </Form.Item>
        <Form.Item
          label={t('sheet_rows.custom_label_en')}
          name="label_en"
          rules={[{ required: true, message: t('sheet_rows.custom_label_required') }]}
        >
          <Input placeholder={t('sheet_rows.placeholder_label_en')} />
        </Form.Item>
        <Form.Item label={t('sheet_rows.custom_label_ru')} name="label_ru">
          <Input placeholder={t('sheet_rows.placeholder_label_ru')} />
        </Form.Item>
        <Form.Item label={t('sheet_rows.custom_label_tk')} name="label_tk">
          <Input placeholder={t('sheet_rows.placeholder_label_tk')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
