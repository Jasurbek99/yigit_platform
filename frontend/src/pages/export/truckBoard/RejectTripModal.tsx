import { Form, Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRejectTrip } from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { apiErrorKey } from './truckBoardHelpers';

const REASON_MAX = 512; // = ExternalTrip.rejection_reason max_length (backend)

interface IRejectTripModalProps {
  trip: IExternalTrip | null;
  onClose: () => void;
}

/** Ask for the reason and tell Planning this trip does not suit us. */
export function RejectTripModal({ trip, onClose }: IRejectTripModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ reason: string }>();
  const reject = useRejectTrip();

  async function handleSubmit() {
    const values = await form.validateFields().catch(() => null);
    if (!trip || !values) return;
    reject.mutate(
      { tripId: trip.id, reason: values.reason.trim() },
      {
        onSuccess: () => {
          toast.success(t('truck_board.rejected_toast'));
          onClose();
        },
        onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
      },
    );
  }

  return (
    <Modal
      open={trip !== null}
      title={trip ? `${t('truck_board.reject_title')} · ${trip.tractor_plate} / ${trip.trailer_plate}` : ''}
      okText={t('truck_board.reject')}
      okButtonProps={{ danger: true, loading: reject.isPending }}
      onOk={handleSubmit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="reason"
          label={t('truck_board.reject_reason')}
          rules={[{ required: true, whitespace: true, message: t('truck_board.error.reason_required') }]}
        >
          <Input.TextArea rows={3} maxLength={REASON_MAX} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
