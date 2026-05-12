import { useState } from 'react';
import { List, Modal, Tag, Typography } from 'antd';
import { toast } from 'sonner';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useAuth } from '@/hooks/useAuth';
import { useStartTask, useUnblockTask } from '@/hooks/useTaskActions';
import { SUPERVISOR_ROLES } from '@/utils/detailSections';
import type { ITaskListItem, TaskState } from '@/types';

dayjs.extend(relativeTime);

const { Text } = Typography;

const STATE_ICON: Record<TaskState, React.ReactNode> = {
  open: <ClockCircleOutlined style={{ color: '#8c8c8c' }} />,
  in_progress: <SyncOutlined spin style={{ color: '#1677ff' }} />,
  blocked: <StopOutlined style={{ color: '#ff4d4f' }} />,
  done: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  cancelled: <StopOutlined style={{ color: '#d9d9d9' }} />,
};

const STATE_COLOR: Record<TaskState, string> = {
  open: 'default',
  in_progress: 'processing',
  blocked: 'error',
  done: 'success',
  cancelled: 'default',
};

function stateLabel(state: TaskState, t: (k: string) => string): string {
  return t(`tasks.state.${state}`);
}

function startedAgo(startedAt: string | null): string {
  if (!startedAt) return '';
  return dayjs(startedAt).fromNow();
}

interface IOtherTasksRowProps {
  tasks: ITaskListItem[];
  /** Called when a row is clicked and the parent should expand the relevant
   *  section + scroll to the task's first target field. */
  onTaskClick?: (task: ITaskListItem) => void;
}

/**
 * Read-only-looking list of tasks that belong to other roles on this shipment.
 *
 * Stream G fix #4: rows are now clickable.
 *
 *   OPEN / IN_PROGRESS / DONE → calls onTaskClick(task) so the Detail page
 *     expands the section containing the task's target fields and scrolls to
 *     the first one. If the current user is the task's assignee_role and the
 *     task isn't already started, also fires POST /tasks/:id/start/ to flip
 *     it to IN_PROGRESS.
 *
 *   BLOCKED → opens a modal showing blocked_reason + an Unblock button (only
 *     enabled for users matching assignee_role or supervisors). Doesn't fire
 *     onTaskClick — user's first action should be to acknowledge the block.
 */
export function OtherTasksRow({ tasks, onTaskClick }: IOtherTasksRowProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const startMutation = useStartTask();
  const unblockMutation = useUnblockTask();

  const [blockedTask, setBlockedTask] = useState<ITaskListItem | null>(null);

  if (tasks.length === 0) return null;

  const role = user?.role ?? '';
  const isSupervisor = SUPERVISOR_ROLES.has(role);

  function canActOnTask(task: ITaskListItem): boolean {
    return isSupervisor || role === task.assignee_role;
  }

  function handleRowClick(task: ITaskListItem) {
    if (task.state === 'blocked') {
      setBlockedTask(task);
      return;
    }
    // Fire /start/ when the current user is the assignee and the task is OPEN.
    // Supervisors don't auto-start someone else's task.
    if (task.state === 'open' && role === task.assignee_role) {
      startMutation.mutate(
        { taskId: task.id, shipmentId: task.shipment },
        {
          onSuccess: () => toast.success(t('shipment.detail.task_started_toast')),
        },
      );
    }
    onTaskClick?.(task);
  }

  function handleUnblock() {
    if (!blockedTask) return;
    unblockMutation.mutate(
      { taskId: blockedTask.id, shipmentId: blockedTask.shipment },
      {
        onSuccess: () => {
          toast.success(t('shipment.detail.task_unblocked_toast'));
          setBlockedTask(null);
        },
      },
    );
  }

  return (
    <>
      <List
        size="small"
        header={
          <Text strong style={{ fontSize: 13 }}>
            {t('shipment.detail.other_tasks_title')}
          </Text>
        }
        dataSource={tasks}
        style={{ background: '#fff', borderRadius: 8, marginBottom: 16 }}
        renderItem={(task) => (
          <List.Item
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            className="other-tasks-row__item"
            onClick={() => handleRowClick(task)}
            actions={[
              task.deadline && (
                <Text
                  type={task.is_overdue ? 'danger' : 'secondary'}
                  style={{ fontSize: 12 }}
                  key="deadline"
                >
                  {dayjs(task.deadline).format('DD MMM HH:mm')}
                </Text>
              ),
            ].filter(Boolean) as React.ReactNode[]}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span>{STATE_ICON[task.state]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t(task.title_key)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <Tag color={STATE_COLOR[task.state]} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                    {stateLabel(task.state, t)}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t(`tasks.role.${task.assignee_role}`)}
                  </Text>
                  {task.started_at && task.state === 'in_progress' && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      · {t('tasks.started_ago', { ago: startedAgo(task.started_at) })}
                    </Text>
                  )}
                  {task.state === 'done' && task.completed_at && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      · {t('tasks.done_at', { time: dayjs(task.completed_at).format('DD MMM HH:mm') })}
                    </Text>
                  )}
                </div>
              </div>
            </div>
          </List.Item>
        )}
      />

      {/* Blocked-task modal: shows reason + Unblock button (gated to assignee/supervisor) */}
      <Modal
        open={blockedTask != null}
        title={t('shipment.detail.task_blocked_modal_title')}
        onCancel={() => setBlockedTask(null)}
        footer={
          blockedTask && canActOnTask(blockedTask)
            ? [
                <button
                  key="cancel"
                  className="ant-btn"
                  onClick={() => setBlockedTask(null)}
                  style={{ marginRight: 8 }}
                >
                  {t('common.cancel')}
                </button>,
                <button
                  key="unblock"
                  className="ant-btn ant-btn-primary"
                  onClick={handleUnblock}
                  disabled={unblockMutation.isPending}
                >
                  {t('shipment.detail.unblock_button')}
                </button>,
              ]
            : null
        }
      >
        {blockedTask && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text strong>{t(blockedTask.title_key)}</Text>
              <Tag color="error" style={{ marginLeft: 8 }}>
                {stateLabel(blockedTask.state, t)}
              </Tag>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('shipment.detail.task_blocked_reason')}:
            </Text>
            <div
              style={{
                marginTop: 6,
                padding: 12,
                background: '#fff1f0',
                border: '1px solid #ffccc7',
                borderRadius: 6,
                fontSize: 13,
                whiteSpace: 'pre-wrap',
              }}
            >
              {blockedTask.blocked_reason || '—'}
            </div>
            {!canActOnTask(blockedTask) && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
                {t('shipment.detail.unblock_role_required', {
                  role: t(`tasks.role.${blockedTask.assignee_role}`),
                })}
              </Text>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
