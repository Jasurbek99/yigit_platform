import { DatePicker, Form, Input, Modal, Select } from 'antd';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs, { type Dayjs } from 'dayjs';
import api from '@/services/api';

interface IShipmentCreateModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

interface ISelectOption {
  id: number;
  name: string;
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
  date: Dayjs;
  country: number;
  customer: number;
  season?: number;
}

export function ShipmentCreateModal({ open, onClose, onSuccess }: IShipmentCreateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();

  const { data: countries, isLoading: countriesLoading } = useQuery({
    queryKey: ['core', 'countries'],
    queryFn: async () => {
      const { data } = await api.get<{ results: ISelectOption[] }>('/core/countries/?page_size=200');
      return data.results;
    },
    staleTime: 5 * 60_000,
  });

  const { data: customers, isLoading: customersLoading } = useQuery({
    queryKey: ['core', 'customers'],
    queryFn: async () => {
      const { data } = await api.get<{ results: ISelectOption[] }>('/core/customers/?page_size=500');
      return data.results;
    },
    staleTime: 5 * 60_000,
  });

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
    onError: () => {
      toast.error(t('shipment_create.toast_error'));
    },
  });

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        const payload: ICreateShipmentPayload = {
          cargo_code: values.cargo_code,
          date: dayjs(values.date).format('YYYY-MM-DD'),
          country: values.country,
          customer: values.customer,
        };
        if (values.season != null) {
          payload.season = values.season;
        }
        createMutation.mutate(payload);
      })
      .catch(() => {
        // validation failed — Ant Design shows inline errors, no action needed
      });
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

  const countryOptions = (countries ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const customerOptions = (customers ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const seasonOptions = (seasons ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  return (
    <Modal
      open={open}
      title={t('shipment_create.title')}
      okText={t('shipment_create.submit')}
      cancelText={t('common.cancel')}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={createMutation.isPending}
      destroyOnHidden
      width="min(480px, 95vw)"
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="cargo_code"
          label={t('shipment_create.cargo_code')}
          help={t('shipment_create.cargo_code_help')}
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
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
        </Form.Item>

        <Form.Item
          name="country"
          label={t('shipment_create.country')}
          rules={[{ required: true, message: t('shipment_create.country') }]}
        >
          <Select
            options={countryOptions}
            loading={countriesLoading}
            showSearch
            optionFilterProp="label"
            placeholder={t('shipment_create.country')}
          />
        </Form.Item>

        <Form.Item
          name="customer"
          label={t('shipment_create.customer')}
          rules={[{ required: true, message: t('shipment_create.customer') }]}
        >
          <Select
            options={customerOptions}
            loading={customersLoading}
            showSearch
            optionFilterProp="label"
            placeholder={t('shipment_create.customer')}
          />
        </Form.Item>

        <Form.Item
          name="season"
          label={
            <>
              {t('shipment_create.season')}{' '}
              <span style={{ color: '#8c8c8c', fontWeight: 'normal', fontSize: 12 }}>
                ({t('shipment_create.season_optional')})
              </span>
            </>
          }
        >
          <Select
            options={seasonOptions}
            loading={seasonsLoading}
            showSearch
            optionFilterProp="label"
            placeholder={t('shipment_create.season')}
            allowClear
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
