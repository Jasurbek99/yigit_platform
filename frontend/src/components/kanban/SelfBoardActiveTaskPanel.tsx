import { useRef } from 'react';
import { Button, Divider, Progress, Space, Tag, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { SelfBoardShipmentFieldList } from './SelfBoardShipmentFieldList';
import { isFieldFilled } from '@/components/shipment/TaskCardEditor.helpers';
import { useStartTask, useCompleteTask } from '@/hooks/useTaskActions';
import type {
  IRowConfig,
  ISheetRowSettingForUser,
  IShipmentDetail,
  IShipmentSheetItem,
  ITaskListItem,
} from '@/types';
import { COLORS } from '@/constants/styles';

const { Text, Title } = Typography;

interface ISelfBoardActiveTaskPanelProps {
  task: ITaskListItem;
  shipment: IShipmentDetail;
  onComplete: () => void;
  /** Sheet data threaded from ActiveDrawerLayout — may be null while loading. */
  sheetItem: IShipmentSheetItem | null;
  rows: IRowConfig[];
  rowSettings: Record<string, ISheetRowSettingForUser>;
  isSheetLoading: boolean;
}

/**
 * Top section of the drawer for tasks the current user owns and can act on.
 *
 * Replaced TaskCardEditor with SelfBoardShipmentFieldList (fields mode) so that
 * driver_name, timestamp fields, and all other sheet-backed fields become editable
 * using SheetCellEditor — exactly the same input widgets as the Sheet page.
 *
 * TaskCardEditor is NOT imported here (it remains on ShipmentDetail). Only the
 * `isFieldFilled` helper is kept (for the progress bar, which uses IShipmentDetail).
 */
export function SelfBoardActiveTaskPanel({
  task,
  shipment,
  onComplete,
  sheetItem,
  rows,
  rowSettings,
  isSheetLoading,
}: ISelfBoardActiveTaskPanelProps): React.ReactElement | null {
  const { t } = useTranslation();

  const startMutation = useStartTask();
  const completeMutation = useCompleteTask();
  const hasStartedRef = useRef(false);

  const targetFields = task.target_fields_list;
  const filledCount = targetFields.filter((fk) => isFieldFilled(shipment, fk)).length;
  const totalCount = targetFields.length;
  const progressPercent =
    totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

  const isManualDone = task.completion_rule === 'manual_done';
  const canComplete =
    isManualDone &&
    (task.state === 'open' || task.state === 'in_progress');
  const isDone = task.state === 'done';
  const isOverdue = task.is_overdue;

  const deadlineDisplay = task.deadline
    ? dayjs(task.deadline).format('DD MMM HH:mm')
    : null;

  function handleFirstEdit(): void {
    if (!hasStartedRef.current && (task.state === 'open' || task.state === 'in_progress')) {
      hasStartedRef.current = true;
      startMutation.mutate({ taskId: task.id, shipmentId: shipment.id });
    }
  }

  function handleMarkDone(): void {
    completeMutation.mutate(
      { taskId: task.id, shipmentId: shipment.id },
      { onSuccess: onComplete },
    );
  }

  return (
    <>
      {/* Task header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
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

      {/* Progress bar */}
      {totalCount > 0 && (
        <div style={{ marginBottom: 12 }}>
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

      {/* Editable target fields — sheet-backed via SelfBoardShipmentFieldList */}
      {targetFields.length > 0 && (
        // Wrap with a presentation div so handleFirstEdit fires on any child click.
        // SelfBoardShipmentFieldList rows do NOT stopPropagation, so clicks bubble.
        <div onClick={handleFirstEdit} onKeyDown={handleFirstEdit} role="presentation">
          <SelfBoardShipmentFieldList
            shipmentId={task.shipment}
            sheetItem={sheetItem}
            rows={rows}
            rowSettings={rowSettings}
            fields={targetFields}
            disabled={isDone || task.state === 'cancelled'}
            isLoading={isSheetLoading}
          />
        </div>
      )}

      {/* Footer */}
      <Divider style={{ margin: '10px 0 8px' }} />
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
        {isDone && (
          <Tag color="success" style={{ margin: 0 }}>
            {t('tasks.state.done')}
          </Tag>
        )}
      </Space>
    </>
  );
}
