import { DatePicker, Flex, Form, Input, Modal, Select } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import api from '@/services/api';
import { CountrySelect } from '@/components/CountrySelect';
import { CustomerSelect } from '@/components/CustomerSelect';

interface IShipmentCreateModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

interface ISeason {
  id: number;
  name: string;
}

interface ICreateShipmentPayload {
  cargo_code: string;
  date: string;
  country: number;
  customer: number;
  season?: number;
}

interface IFormValues {
  cargo_code: string;
  date: dayjs.Dayjs | null;
  country: number | undefined;
  customer: number | undefined;
  season: number | undefined;
}

export function ShipmentCreateModal({ open, onClose, onSuccess }: IShipmentCreateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();

  const { data: seasons, isLoading: seasonsLoading } = useQuery({
    queryKey: ['core', 'seasons'],
    queryFn: async () => {
      const { data } = await api.get<{ results: ISeason[] }>('/export/admin/seasons/?page_size=50');
      return data.results;
    },
    staleTime: 5 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: ICreateShipmentPayload) => {
      await api.post('/export/shipments/', payload);
    },
    onSuccess: () => {
      toast.success(t('shipment_create.toast_success'));
      form.resetFields();
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      const apiErr = err as { response?: { data?: Record<string, string[]> } };
      const data = apiErr?.response?.data;
      if (data?.cargo_code) {
        form.setFields([{ name: 'cargo_code', errors: data.cargo_code }]);
      } else {
        toast.error(t('shipment_create.toast_error'));
      }
    },
  });

  async function handleOk() {
    const values = await form.validateFields();
    const payload: ICreateShipmentPayload = {
      cargo_code: values.cargo_code,
      date: values.date ? values.date.format('YYYY-MM-DD') : '',
      country: values.country!,
      customer: values.customer!,
    };
    if (values.season != null) {
      payload.season = values.season;
    }
    createMutation.mutate(payload);
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

  const seasonOptions = (seasons ?? []).map((s) => ({ value: s.id, label: s.name }));

  return (
    <Modal
      title={t('shipment_create.title')}
      open={open}
      onCancel={handleCancel}
      onOk={() => void handleOk()}
      okText={t('shipment_create.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={createMutation.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="cargo_code"
          label={t('shipment_create.cargo_code')}
          extra={t('shipment_create.cargo_code_help')}
          rules={[
            { required: true, message: t('shipment_create.cargo_code') },
            {
              pattern: /^\d{7}\/\d{2}$/,
              message: t('shipment_create.cargo_code_format'),
            },
          ]}
        >
          <Input placeholder="0201045/25" maxLength={20} />
        </Form.Item>

        <Form.Item
          name="date"
          label={t('shipment_create.date')}
          rules={[{ required: true, message: t('shipment_create.date') }]}
        >
          <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="country"
          label={t('shipment_create.country')}
          rules={[{ required: true, message: t('shipment_create.country') }]}
        >
          <CountrySelect placeholder={t('shipment_create.country')} allowClear={false} />
        </Form.Item>

        <Form.Item
          name="customer"
          label={t('shipment_create.customer')}
          rules={[{ required: true, message: t('shipment_create.customer') }]}
        >
          <CustomerSelect placeholder={t('shipment_create.customer')} allowClear={false} />
        </Form.Item>

        <Form.Item
          name="season"
          label={
            <Flex gap={4} align="center">
              <span>{t('shipment_create.season')}</span>
              <span style={{ color: '#8c8c8c', fontSize: 12, fontWeight: 400 }}>
                ({t('shipment_create.season_optional')})
              </span>
            </Flex>
          }
        >
          <Select
            allowClear
            loading={seasonsLoading}
            options={seasonOptions}
            placeholder={t('shipment_create.season')}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
