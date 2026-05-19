import { Alert, Flex, Form, Modal, Select, Switch } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useState } from 'react';
import api from '@/services/api';
import { CountrySelect } from '@/components/CountrySelect';
import { CustomerSelect } from '@/components/CustomerSelect';
import { COLORS } from '@/constants/styles';

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
  country?: number;
  customer?: number;
  season?: number;
  is_draft?: boolean;
  block_sources?: { block_id: number; weight_kg: number }[];
}

interface IFormValues {
  country: number | undefined;
  customer: number | undefined;
  season: number | undefined;
}

/**
 * Lightweight shipment create modal.
 *
 * Does NOT ask for cargo_code or shipment date — those are handled
 * automatically:
 *   - cargo_code: server-generated DDMMNNN/YY format. The platform-internal
 *     identifier; not the same as Soltanmyrat's pallet tag
 *     (official_export_code), which he fills in later via the Sheet.
 *   - date: defaults to today server-side; editable later via Sheet/Detail.
 *
 * Default: shipment is created as a DRAFT. Prep tasks (set destination,
 * pick firms, assign driver, start documents prep) appear on the Self
 * Kanban for the appropriate roles. The shipment is promoted to Loading
 * via the "Promote to Loading" button on the Detail page once prep is
 * done — that's when loading_started_at is written.
 *
 * "Skip prep" toggle creates directly at Loading. Reserved for urgent
 * reshipments and legacy data imports.
 */
export function ShipmentCreateModal({ open, onClose, onSuccess }: IShipmentCreateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();

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
    onError: () => {
      toast.error(t('shipment_create.toast_error'));
    },
  });

  async function handleOk() {
    const values = await form.validateFields();
    const payload: ICreateShipmentPayload = {
      is_draft: !skipPrep,
      block_sources: [],
    };
    if (values.country != null) payload.country = values.country;
    if (values.customer != null) payload.customer = values.customer;
    if (values.season != null) payload.season = values.season;
    createMutation.mutate(payload);
  }

  function handleCancel() {
    form.resetFields();
    setSkipPrep(false);
    onClose();
  }

  const seasonOptions = (seasons ?? []).map((s) => ({ value: s.id, label: s.name }));

  // When skip_prep is OFF (default — draft path), country/customer are
  // optional — they're assigned later before promoting to Loading.
  // When skip_prep is ON, the shipment lands directly in Loading and
  // requires destination at creation time.
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
            background: COLORS.bgLayout,
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>
              {t('shipment_create.skip_prep')}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
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

        {!skipPrep ? (
          <Alert
            type="info"
            message={t('shipment_create.draft_mode_alert')}
            style={{ marginBottom: 16 }}
            showIcon
          />
        ) : (
          <Alert
            type="warning"
            message={t('shipment_create.skip_prep_alert')}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}

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
              <span style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 400 }}>
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
