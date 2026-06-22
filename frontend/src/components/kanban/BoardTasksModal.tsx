import { List, Modal, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  RightOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { IBoardItem } from '@/hooks/useShipmentBoard';
import type { ITaskListItem, TaskState } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

const STATE_ICON: Record<TaskState, React.ReactNode> = {
  open: <ClockCircleOutlined style={{ color: COLORS.textSecondary }} />,
  in_progress: <SyncOutlined spin style={{ color: COLORS.primary }} />,
  blocked: <StopOutlined style={{ color: COLORS.danger }} />,
  done: <CheckCircleOutlined style={{ color: COLORS.success }} />,
  cancelled: <StopOutlined style={{ color: COLORS.borderLight }} />,
};

const STATE_COLOR: Record<TaskState, string> = {
  open: 'default',
  in_progress: 'processing',
  blocked: 'error',
  done: 'success',
  cancelled: 'default',
};

const { Text } = Typography;

interface IBoardTasksModalProps {
  /** Shipment whose tasks are listed; null = modal closed. */
  item: IBoardItem | null;
  onClose: () => void;
  /** Open the SelfBoardTaskDrawer for the clicked task to act on it. */
  onTaskClick: (task: ITaskListItem) => void;
}

/**
 * Lists every task on a Shipment Board card (the "done/total" behind the count).
 * Clicking a row opens the shared SelfBoardTaskDrawer so the user can actually
 * do the task — start it, fill its fields, mark it done — without navigating to
 * the shipment detail page. The parent hides this modal while the drawer is open
 * (the two never overlap), so no z-index/focus-trap juggling is needed here.
 */
export function BoardTasksModal({ item, onClose, onTaskClick }: IBoardTasksModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function handleOpenDetail(): void {
    if (item == null) return;
    onClose();
    navigate(`/shipments/${item.id}`);
  }

  return (
    <Modal
      open={item != null}
      onCancel={onClose}
      footer={null}
      width={520}
      title={
        item != null && (
          <span style={{ fontFamily: FONT.mono, fontSize: 14 }}>
            {item.shipment_code}
            <Text type="secondary" style={{ fontFamily: 'inherit', fontSize: 12, marginLeft: 8 }}>
              {t('shipment_board.tasks_progress', {
                done: item.tasks_done,
                total: item.tasks_total,
              })}
            </Text>
          </span>
        )
      }
    >
      {item != null && (
        <List
          size="small"
          dataSource={item.tasks}
          locale={{ emptyText: t('shipment_board.no_tasks') }}
          renderItem={(task) => (
            <List.Item
              style={{ padding: '10px 8px', cursor: 'pointer' }}
              className="board-tasks-modal__item"
              onClick={() => onTaskClick(task)}
              actions={[
                task.deadline ? (
                  <Text
                    key="deadline"
                    type={task.is_overdue ? 'danger' : 'secondary'}
                    style={{ fontSize: 12 }}
                  >
                    {dayjs(task.deadline).format('DD MMM HH:mm')}
                  </Text>
                ) : null,
              ].filter(Boolean) as React.ReactNode[]}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <span>{STATE_ICON[task.state]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t(task.title_key)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <Tag color={STATE_COLOR[task.state]} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                      {t(`tasks.state.${task.state}`)}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {t(`tasks.role.${task.assignee_role}`)}
                    </Text>
                  </div>
                </div>
              </div>
            </List.Item>
          )}
        />
      )}

      {/* The only path to the full detail page — the card itself no longer
          navigates (tasks are done in-board). */}
      {item != null && (
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Typography.Link onClick={handleOpenDetail} style={{ fontSize: 13 }}>
            {t('shipment_board.open_detail')} <RightOutlined style={{ fontSize: 10 }} />
          </Typography.Link>
        </div>
      )}
    </Modal>
  );
}
