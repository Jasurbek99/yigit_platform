import { List, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, StopOutlined, SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
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
}

/**
 * Read-only compact list of tasks that belong to other roles on this shipment.
 * Each row: state icon, task title, assignee role label, deadline, status text.
 */
export function OtherTasksRow({ tasks }: IOtherTasksRowProps) {
  const { t } = useTranslation();

  if (tasks.length === 0) return null;

  return (
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
          style={{ padding: '8px 16px' }}
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
  );
}
