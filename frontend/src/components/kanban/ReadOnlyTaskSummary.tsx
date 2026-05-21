import { Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { ITaskListItem } from '@/types';

const { Text } = Typography;

interface IReadOnlyTaskSummaryProps {
  task: ITaskListItem;
}

export function ReadOnlyTaskSummary({ task }: IReadOnlyTaskSummaryProps): React.ReactElement {
  const { t } = useTranslation();

  const completedDisplay = task.completed_at
    ? dayjs(task.completed_at).format('DD MMM YYYY HH:mm')
    : null;
  const deadlineDisplay = task.deadline
    ? dayjs(task.deadline).format('DD MMM YYYY HH:mm')
    : null;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Tag color={task.state === 'done' ? 'success' : 'default'} style={{ margin: 0 }}>
        {t(`tasks.state.${task.state}`)}
      </Tag>

      {deadlineDisplay && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {deadlineDisplay}
        </Text>
      )}

      {completedDisplay && (
        <Text>
          {t('me.board.drawer_readonly_completed', { when: completedDisplay })}
        </Text>
      )}
    </Space>
  );
}
