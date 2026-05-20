import { useState } from 'react';
import { Modal, Form, Select, Input, Alert, Progress, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';
import { FONT } from '@/constants/styles';

const { Text } = Typography;

const STATUS_DISPLAY: Record<string, string> = {
  yuklenme: 'Loading',
  gumruk_girish: 'Customs Entry',
  gumruk_chykysh: 'Customs Exit',
  yola_chykdy: 'Departed',
  serhet_tm: 'TM Border',
  serhet_gechdi: 'Border Crossed',
  barysh_gumrugi: 'Dest Customs',
  yolda: 'In Transit',
  bardy: 'Arrived',
  satylyar: 'Being Sold',
  satyldy: 'Sold',
  hasabat: 'Report',
  tamamlandy: 'Completed',
};

interface IShipmentBulkTransitionModalProps {
  open: boolean;
  onClose: () => void;
  shipmentIds: number[];
  /** Called after the run finishes (whether all succeeded or some failed). */
  onFinished?: () => void;
}

interface IFailure {
  id: number;
  message: string;
}

/**
 * Fan-out bulk transition. Calls POST /shipments/{id}/transition/ per id.
 * Shows running progress and a per-row error summary on completion.
 * No backend changes needed — reuses the existing endpoint.
 */
export function ShipmentBulkTransitionModal({
  open,
  onClose,
  shipmentIds,
  onFinished,
}: IShipmentBulkTransitionModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ new_status: string; comment?: string }>();

  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failures, setFailures] = useState<IFailure[]>([]);

  const total = shipmentIds.length;

  function reset() {
    setRunning(false);
    setCompleted(0);
    setFailures([]);
    form.resetFields();
  }

  function handleClose() {
    if (running) return;
    reset();
    onClose();
  }

  async function handleConfirm() {
    const values = await form.validateFields();
    setRunning(true);
    setCompleted(0);
    setFailures([]);

    const results = await Promise.allSettled(
      shipmentIds.map(async (id) => {
        try {
          await api.post(`/export/shipments/${id}/transition/`, {
            new_status: values.new_status,
            comment: values.comment?.trim() || undefined,
          });
          setCompleted((c) => c + 1);
        } catch (err: unknown) {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            t('shipment_bulk.transition_unknown_error');
          setCompleted((c) => c + 1);
          throw { id, message: msg } as IFailure;
        }
      }),
    );

    const fails: IFailure[] = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as IFailure);

    setFailures(fails);
    setRunning(false);

    await queryClient.invalidateQueries({ queryKey: ['shipments'] });

    const okCount = total - fails.length;
    if (fails.length === 0) {
      toast.success(t('shipment_bulk.transition_all_ok', { count: total }));
      reset();
      onClose();
      onFinished?.();
    } else {
      toast.warning(
        t('shipment_bulk.transition_partial', { ok: okCount, fail: fails.length }),
      );
      // Keep modal open so the user can review which rows failed
    }
  }

  const targetOptions = Object.entries(STATUS_DISPLAY).map(([code, label]) => ({
    value: code,
    label,
  }));

  return (
    <Modal
      open={open}
      title={t('shipment_bulk.transition_title', { count: total })}
      onCancel={handleClose}
      onOk={() => void handleConfirm()}
      okText={
        running
          ? t('shipment_bulk.transition_running', { done: completed, total })
          : failures.length > 0
            ? t('shipment_bulk.transition_retry')
            : t('shipment_bulk.transition_apply')
      }
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: running }}
      cancelButtonProps={{ disabled: running }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="new_status"
          label={t('shipment_bulk.target_status')}
          rules={[{ required: true, message: t('shipment_bulk.select_target') }]}
        >
          <Select
            options={targetOptions}
            placeholder={t('shipment_bulk.select_target')}
            disabled={running}
            showSearch
          />
        </Form.Item>
        <Form.Item name="comment" label={t('shipment_bulk.comment_label')}>
          <Input.TextArea
            rows={3}
            placeholder={t('shipment_bulk.comment_placeholder')}
            disabled={running}
          />
        </Form.Item>
      </Form>

      {(running || completed > 0) && (
        <Progress
          percent={total === 0 ? 0 : Math.round((completed / total) * 100)}
          status={running ? 'active' : failures.length > 0 ? 'exception' : 'success'}
          format={() => `${completed}/${total}`}
        />
      )}

      {failures.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={t('shipment_bulk.transition_failures', { count: failures.length })}
          description={
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {failures.map((f) => (
                <div key={f.id} style={{ fontSize: 12, fontFamily: FONT.mono }}>
                  <Text type="danger">#{f.id}</Text> — {f.message}
                </div>
              ))}
            </div>
          }
        />
      )}
    </Modal>
  );
}
