import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { GateAction } from '@/hooks/useGate';

interface IGateConfirmModalProps {
  readonly pending: { plate: string; action: GateAction } | null;
  readonly loading: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Every gate tap is confirmed with the plate in large type — a status move cannot be taken back. */
export function GateConfirmModal({ pending, loading, onConfirm, onCancel }: IGateConfirmModalProps) {
  const { t } = useTranslation();
  const key = pending?.action.startsWith('undo') ? 'undo' : pending?.action;
  return (
    <Modal
      open={pending !== null}
      centered
      destroyOnClose
      title={pending ? t(`gate.confirm_${key}`, { plate: pending.plate }) : ''}
      okText={t('gate.yes')}
      cancelText={t('common.cancel')}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okButtonProps={{ size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
    />
  );
}
