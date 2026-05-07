import { Alert, DatePicker, Flex, Form, Input, Modal, Select, Switch } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useState } from 'react';
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
  country?: number;
  customer?: number;
  season?: number;
  is_draft?: boolean;
  block_sources?: { block_id: number; weight_kg: number }[];
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

  // Stream F: default is to start in DRAFT (full lifecycle including draft-stage
  // tasks: pick destination, firms, driver, etc.). The "Skip prep" switch flips
  // back to the legacy yuklenme-direct path for emergencies (urgent reshipments,
  // legacy data imports).
  const [skipPrep, setSkipPrep] = useState(false);

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
      const messageKey = skipPrep
        ? 'shipment_create.toast_success_loading'
        : 'shipment_create.toast_success_draft';
      toast.success(t(messageKey));
      form.resetFields();
      setSkipPrep(false);
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
      is_draft: !skipPrep,
    };
    if (values.country != null) payload.country = values.country;
    if (values.customer != null) payload.customer = values.customer;
    if (values.season != null) payload.season = values.season;
    // Stream F: drafts created from this modal are lightweight — no block
    // sources up-front. Soltanmyrat or Gadam adds them later via the Sheet
    // or via the supply-side DraftPool flow. The backend serializer was
    // relaxed to allow empty block_sources for drafts.
    payload.block_sources = [];
    createMutation.mutate(payload);
  }

  function handleCancel() {
    form.resetFields();
    setSkipPrep(false);
    onClose();
  }

  const seasonOptions = (seasons ?? []).map((s) => ({ value: s.id, label: s.name }));

  // When skip_prep is OFF (default — draft path), country/customer become
  // optional — they'll be assigned later before promoting to Loading.
  const destinationRequired = skipPrep;

  return (
    <Modal
      title={t('shipment_create.title')}
      open={open}
      onCancel={handleCancel}
      onOk={() => void handleOk()}
      okText={t('shipment_create.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={createMutation.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Flex
          align="center"
          justify="space-between"
          gap={12}
          style={{
            padding: '8px 12px',
            background: '#fafafa',
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>
              {t('shipment_create.skip_prep')}
            </div>
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              {t('shipment_create.skip_prep_help')}
            </div>
          </div>
          <Switch
            checked={skipPrep}
            onChange={setSkipPrep}
            checkedChildren={t('shipment_create.skip_prep_on')}
            unCheckedChildren={t('shipment_create.skip_prep_off')}
          />
        </Flex>

        {!skipPrep && (
          <Alert
            type="info"
            message={t('shipment_create.draft_mode_alert')}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}

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
          rules={
            destinationRequired
              ? [{ required: true, message: t('shipment_create.country') }]
              : []
          }
        >
          <CountrySelect
            placeholder={t('shipment_create.country')}
            allowClear={!destinationRequired}
          />
        </Form.Item>

        <Form.Item
          name="customer"
          label={t('shipment_create.customer')}
          rules={
            destinationRequired
              ? [{ required: true, message: t('shipment_create.customer') }]
              : []
          }
        >
          <CustomerSelect
            placeholder={t('shipment_create.customer')}
            allowClear={!destinationRequired}
          />
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
