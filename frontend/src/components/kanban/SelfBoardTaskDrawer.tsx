import { Alert, Button, Drawer, Skeleton, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { MyTaskCard } from '@/components/shipment/MyTaskCard';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import type { ITaskListItem, ShipmentPhase } from '@/types';
import { FONT } from '@/constants/styles';

const { Text } = Typography;

const PHASE_TAG_COLOR: Record<ShipmentPhase, string> = {
  PLAN: 'default',
  PREP: 'orange',
  DOCS: 'gold',
  LOAD: 'blue',
  TRANSIT: 'cyan',
  DEST: 'purple',
  CLOSE: 'green',
};

interface ISelfBoardTaskDrawerProps {
  task: ITaskListItem | null;
  onClose: () => void;
}

export function SelfBoardTaskDrawer({ task, onClose }: ISelfBoardTaskDrawerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: shipment, isLoading, isError } = useShipmentDetail(task?.shipment);

  const isActiveState =
    task != null &&
    (task.state === 'open' || task.state === 'in_progress' || task.state === 'blocked');
  const isActiveCard = isActiveState && shipment?.my_task?.id === task.id;

  function handleOpenShipment() {
    if (task == null) return;
    navigate(`/shipments/${task.shipment}`);
  }

  return (
    <Drawer
      open={task != null}
      onClose={onClose}
      placement="right"
      width={480}
      destroyOnClose
      title={
        task != null && (
          <Space size={8}>
            <Tag color={PHASE_TAG_COLOR[task.phase]} style={{ margin: 0 }}>
              {task.phase}
            </Tag>
            <Text strong>{t(task.title_key)}</Text>
          </Space>
        )
      }
      footer={
        task != null && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="link" onClick={handleOpenShipment}>
              {t('me.board.drawer_open_shipment')}
            </Button>
          </div>
        )
      }
    >
      {task == null ? null : isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : isError || !shipment ? (
        <Alert type="error" message={t('common.error')} />
      ) : isActiveCard ? (
        <MyTaskCard shipment={shipment} />
      ) : (
        <ReadOnlyTaskSummary task={task} />
      )}
    </Drawer>
  );
}

interface IReadOnlyTaskSummaryProps {
  task: ITaskListItem;
}

function ReadOnlyTaskSummary({ task }: IReadOnlyTaskSummaryProps) {
  const { t } = useTranslation();

  const completedDisplay = task.completed_at
    ? dayjs(task.completed_at).format('DD MMM YYYY HH:mm')
    : null;
  const deadlineDisplay = task.deadline
    ? dayjs(task.deadline).format('DD MMM YYYY HH:mm')
    : null;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
        {task.shipment_cargo_code}
      </div>

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
