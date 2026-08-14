import { Form, Modal } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import api from '@/services/api';
import { IDEMPOTENCY_HEADER, useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { CountrySelect } from '@/components/CountrySelect';
import { CustomerSelect } from '@/components/CustomerSelect';

interface IShipmentCreateModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

interface ICreateShipmentPayload {
  country?: number;
  customer?: number;
  is_draft: boolean;
  block_sources: { block_id: number; weight_kg: number }[];
}

interface IFormValues {
  country: number | undefined;
  customer: number | undefined;
}

/**
 * Lightweight shipment create modal.
 *
 * Does NOT ask for shipment_code, date or season — those are handled
 * automatically server-side:
 *   - shipment_code: server-generated DDMMNNN/YY. Platform-internal id, not
 *     Soltanmyrat's pallet tag (export_code), which he fills later via Sheet.
 *   - date: defaults to today; editable later via Sheet/Detail.
 *   - season: assigned from the active season.
 *
 * Every shipment is created as a DRAFT. Destination (country/customer) is
 * optional here and can be filled in later; prep tasks (set destination,
 * pick firms, assign driver, start documents prep) appear on the Self Kanban
 * for the appropriate roles. The shipment is promoted to Loading via the
 * "Promote to Loading" button on the Detail page once prep is done — that's
 * when loading_started_at is written.
 */
export function ShipmentCreateModal({ open, onClose, onSuccess }: IShipmentCreateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();

  const idem = useIdempotencyKey();
  const createMutation = useMutation({
    mutationFn: async (payload: ICreateShipmentPayload) => {
      await api.post('/export/shipments/', payload, {
        headers: { [IDEMPOTENCY_HEADER]: idem.key },
      });
    },
    onSuccess: () => {
      idem.reset();
      toast.success(t('shipment_create.toast_success_draft'));
      form.resetFields();
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
      is_draft: true,
      block_sources: [],
    };
    if (values.country != null) payload.country = values.country;
    if (values.customer != null) payload.customer = values.customer;
    createMutation.mutate(payload);
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

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
        <Form.Item name="country" label={t('shipment_create.country')}>
          <CountrySelect placeholder={t('shipment_create.country')} allowClear />
        </Form.Item>

        <Form.Item name="customer" label={t('shipment_create.customer')}>
          <CustomerSelect placeholder={t('shipment_create.customer')} allowClear />
        </Form.Item>
      </Form>
    </Modal>
  );
}
