import { DatePicker, Form, InputNumber, Modal, Select } from 'antd';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import { useAdminFirms } from '@/hooks/useAdmin';
import { useCreateQuotaUsage } from '@/hooks/useQuotaUsage';

interface IQuotaUsageCreateModalProps {
  open: boolean;
  onClose: () => void;
  productType: string;
}

interface IFormValues {
  usage_date: Dayjs;
  export_firm: number;
  kg_used: number;
}

/**
 * Hand-enter a usage row that has no shipment behind it.
 *
 * The date × firm matrix used to be the only way in — typing into an empty cell
 * POSTed a row. It was removed on 2026-08-11 in favour of the by-shipment view,
 * which has no empty cells to type into, so manual entry needs its own door.
 * These are the same shape as the 575 historical Excel imports: a firm spent the
 * kg, but no live shipment row stands behind it.
 */
export function QuotaUsageCreateModal({
  open,
  onClose,
  productType,
}: IQuotaUsageCreateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();
  const { data: firms = [] } = useAdminFirms();
  const createMutation = useCreateQuotaUsage();

  const firmOptions = firms
    .filter((f) => f.is_active)
    .map((f) => ({ value: f.id, label: f.name_en || f.name_tk || String(f.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  function handleOk() {
    form.validateFields().then((values) => {
      createMutation.mutate(
        {
          usage_date: values.usage_date.format('YYYY-MM-DD'),
          export_firm: values.export_firm,
          kg_used: values.kg_used,
          product_type: productType,
        },
        {
          onSuccess: () => {
            toast.success(t('quota_usage.manual_created'));
            form.resetFields();
            onClose();
          },
          // The backend rejects a date outside every season (400) — surface its
          // message rather than a generic one, since that is the likely failure.
          onError: (error: unknown) => {
            const detail =
              (error as { response?: { data?: { usage_date?: string[] } } })
                ?.response?.data?.usage_date?.[0];
            toast.error(detail ?? t('quota_usage.save_error'));
          },
        },
      );
    });
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={createMutation.isPending}
      title={t('quota_usage.manual_add')}
      okText={t('quota_usage.manual_save')}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ usage_date: dayjs() }}>
        <Form.Item
          name="usage_date"
          label={t('quota_usage.date')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" allowClear={false} />
        </Form.Item>
        <Form.Item
          name="export_firm"
          label={t('quota_usage.firm')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Select options={firmOptions} showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item
          name="kg_used"
          label={t('quota_usage.kg_used')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <InputNumber min={1} step={100} style={{ width: '100%' }} suffix="kg" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
