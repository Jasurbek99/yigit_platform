import { useState } from 'react';
import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { gateErrorCode, useGateAction } from '@/hooks/useGate';
import type { GateAction } from '@/hooks/useGate';
import { GateConfirmModal } from '@/components/gate/GateConfirmModal';
import { canDo } from '@/utils/permissions';
import type { ITaskListItem } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IGateTaskCardProps {
  readonly task: ITaskListItem;
}

/**
 * A gate task (kind='gate') on My Tasks. Its button does exactly what the gate
 * screen's does — same endpoint — so the task closes the same way. No generic
 * "Done": a gate task must never close without the mark.
 */
export function GateTaskCard({ task }: IGateTaskCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const gateAction = useGateAction();
  const [confirming, setConfirming] = useState(false);
  const action: GateAction = task.step === 'gate_depart' ? 'depart' : 'arrive';
  const plate = task.truck_plate ?? task.shipment_code;
  const isOpen = task.state === 'open' || task.state === 'in_progress';
  const isGuard = user?.role === 'garawul';
  // Supervisors see every role's tasks but may lack the `gate` grant — no
  // button that can only 403. canDo also blocks a boss in view mode
  // (final-fix review F9) — the hand-built check it replaces did not.
  const canMark = canDo(user, 'gate', 'edit');
  const locationId = isGuard ? null : task.scope_location;

  function handleConfirm() {
    if (task.shipment == null) return;
    gateAction.mutate(
      { id: task.shipment, action, locationId },
      {
        onSuccess: () => toast.success(t(`gate.done_${action}`)),
        onError: (error) => {
          const code = gateErrorCode(error);
          // The global axios interceptor already toasts season_closed
          // (services/api.ts) — skip the second toast here (final-fix F13).
          if (code === 'season_closed') return;
          toast.error(t(`gate.error.${code ?? 'generic'}`, { defaultValue: t('gate.error.generic') }));
        },
        onSettled: () => setConfirming(false),
      },
    );
  }

  return (
    <div
      style={{
        background: COLORS.white,
        border: '1px solid #f0f0f0',
        borderLeft: `3px solid ${isOpen ? COLORS.primary : COLORS.borderLight}`,
        borderRadius: 6,
        padding: '8px 10px',
        opacity: isOpen ? 1 : 0.6,
      }}
    >
      <Text strong>{t(task.title_key, { plate })}</Text>
      {isOpen && canMark && (
        <Button type="primary" size="large" block onClick={() => setConfirming(true)} style={{ marginTop: 8 }}>
          {t(`gate.${action}`)}
        </Button>
      )}
      <GateConfirmModal
        pending={confirming ? { plate, action } : null}
        loading={gateAction.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
