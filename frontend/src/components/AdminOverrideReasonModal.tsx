import { useState, useEffect } from 'react';
import { Modal, Form, Input, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;
const { TextArea } = Input;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IAdminOverrideReasonModalProps {
  open: boolean;
  oldValue: number | null;
  newValue: number | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminOverrideReasonModal({
  open,
  oldValue,
  newValue,
  onConfirm,
  onCancel,
}: IAdminOverrideReasonModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  // Reset reason text whenever the modal opens fresh
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  function handleOk() {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  const oldDisplay = oldValue == null ? '—' : oldValue.toLocaleString();
  const newDisplay = newValue == null ? '—' : newValue.toLocaleString();

  return (
    <Modal
      open={open}
      title={t('plan.override_modal_title')}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !reason.trim() }}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnClose
      width={440}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        {t('plan.override_old_to_new', { old: oldDisplay, new: newDisplay })}
      </Text>

      <Form layout="vertical">
        <Form.Item
          label={t('plan.override_reason_label')}
          required
          validateStatus={reason.trim() ? '' : 'warning'}
          help={reason.trim() ? '' : t('plan.override_reason_required')}
        >
          <TextArea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleOk();
            }}
            placeholder={t('plan.override_reason_label')}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
