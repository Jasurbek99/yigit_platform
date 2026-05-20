import { useRef } from 'react';
import { Button, Card, Progress, Tag, Typography, Space, Divider } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { TaskCardEditor } from '@/components/shipment/TaskCardEditor';
import { isFieldFilled } from '@/components/shipment/TaskCardEditor.helpers';
import { useStartTask, useCompleteTask } from '@/hooks/useTaskActions';
import { useAuth } from '@/hooks/useAuth';
import { SUPERVISOR_ROLES } from '@/utils/detailSections';
import type { IShipmentDetail, ITaskDetail, ITaskListItem } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text, Title } = Typography;

interface IMyTaskCardProps {
  shipment: IShipmentDetail;
  /**
   * Render the editor for this specific task instead of the shipment's
   * `my_task`. Used by the Self Board drawer where the user clicks a
   * specific card — that task may not match `shipment.my_task` when the
   * shipment has multiple active tasks for the user. Defaults to
   * `shipment.my_task` so existing callers (Shipment Detail page) are
   * unaffected.
   */
  task?: ITaskDetail | ITaskListItem | null;
}

/**
 * The main "Your Task" card rendered when the current user has an active task
 * on this shipment. Shows progress, editable target fields, and action buttons.
 *
 * When the user first edits a field, fires POST /tasks/:id/start/ (debounced
 * to at-most-once via a ref flag).
 *
 * Stream G fix #3 — banner logic when there's no my_task:
 *   - Supervisor roles: render nothing (they oversee via OtherTasksRow).
 *   - Operational role with other tasks active: show a soft "N tasks are
 *     with other roles, you'll be notified" message instead of the
 *     misleading "you have no task" empty-state.
 *   - Operational role with no tasks at all: keep the empty-state banner
 *     (truly nothing happening — likely a fresh draft awaiting rule engine).
 */
export function MyTaskCard({ shipment, task: taskOverride }: IMyTaskCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const task = taskOverride ?? shipment.my_task;

  const startMutation = useStartTask();
  const completeMutation = useCompleteTask();

  // Prevent firing /start/ more than once per mount
  const hasStartedRef = useRef(false);

  if (task == null) {
    const isSupervisor = SUPERVISOR_ROLES.has(user?.role ?? '');
    if (isSupervisor) return null;

    const otherActive = shipment.other_tasks.filter(
      (t) => t.state === 'open' || t.state === 'in_progress' || t.state === 'blocked',
    ).length;

    if (otherActive > 0) {
      return (
        <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('shipment.detail.not_your_turn', { count: otherActive })}
          </Text>
        </Card>
      );
    }

    return (
      <Card style={{ marginBottom: 16 }}>
        <Text type="secondary">{t('shipment.detail.no_active_task')}</Text>
      </Card>
    );
  }

  const isOverdue = task.is_overdue;
  const isManualDone = task.completion_rule === 'manual_done';
  const canComplete =
    isManualDone &&
    (task.state === 'open' || task.state === 'in_progress');

  // Compute field fill progress
  const targetFields = task.target_fields_list;
  const filledCount = targetFields.filter((fk) => isFieldFilled(shipment, fk)).length;
  const totalCount = targetFields.length;
  const progressPercent = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

  function handleFirstEdit() {
    if (!hasStartedRef.current && (task!.state === 'open' || task!.state === 'in_progress')) {
      hasStartedRef.current = true;
      startMutation.mutate({ taskId: task!.id, shipmentId: shipment.id });
    }
  }

  function handleMarkDone() {
    completeMutation.mutate({ taskId: task!.id, shipmentId: shipment.id });
  }

  // Format deadline
  const deadlineDisplay = task.deadline
    ? dayjs(task.deadline).format('DD MMM HH:mm')
    : null;

  return (
    <Card
      style={{
        marginBottom: 16,
        border: isOverdue ? '1px solid #ff4d4f' : undefined,
        borderRadius: 8,
      }}
      styles={isOverdue ? { header: { background: '#fff1f0' } } : undefined}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, fontWeight: 400 }}>
            {t(`tasks.role.${task.assignee_role}`)}
          </Text>
          <Title level={5} style={{ margin: 0, fontSize: 15 }}>
            {t(task.title_key)}
          </Title>
          {deadlineDisplay && (
            <Tag
              icon={<ClockCircleOutlined />}
              color={isOverdue ? 'error' : 'default'}
              style={{ margin: 0 }}
            >
              {deadlineDisplay}
            </Tag>
          )}
        </div>
      }
    >
      {/* Progress bar (only when there are target fields) */}
      {totalCount > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('tasks.target_fields_progress', { filled: filledCount, total: totalCount })}
            </Text>
          </div>
          <Progress
            percent={progressPercent}
            size="small"
            status={progressPercent === 100 ? 'success' : 'active'}
            style={{ marginBottom: 0 }}
          />
        </div>
      )}

      {/* Editable fields */}
      {targetFields.length > 0 && (
        <div onClick={handleFirstEdit} onKeyDown={handleFirstEdit} role="presentation">
          <TaskCardEditor
            shipment={shipment}
            targetFields={targetFields}
            disabled={task.state === 'done' || task.state === 'cancelled'}
          />
        </div>
      )}

      {/* Footer actions */}
      <Divider style={{ margin: '12px 0 10px' }} />
      <Space>
        {canComplete && (
          <Button
            type="primary"
            onClick={handleMarkDone}
            loading={completeMutation.isPending}
          >
            {t('shipment.detail.mark_done')}
          </Button>
        )}
        {task.state === 'done' && (
          <Tag color="success" style={{ margin: 0 }}>
            {t('tasks.state.done')}
          </Tag>
        )}
      </Space>
    </Card>
  );
}
