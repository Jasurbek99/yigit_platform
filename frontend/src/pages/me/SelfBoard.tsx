import { useState, useCallback } from 'react';
import {
  Alert,
  Badge,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { useAuth } from '@/hooks/useAuth';

// Today-midnight boundary for the "Done today" filter must be anchored to
// Asia/Ashgabat regardless of the user's OS clock — Windows machines joined
// to KZ/RU domains often run UTC, which would otherwise shift the boundary
// by 5 hours and hide tasks completed in the early TM morning.
dayjs.extend(utc);
dayjs.extend(timezone);
const TM_TZ = 'Asia/Ashgabat';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useMyKpiToday } from '@/hooks/useMyKpiToday';
import { useBlockTask, useUnblockTask } from '@/hooks/useTaskActions';
import { KanbanColumn } from '@/components/kanban/KanbanColumn';
import { SelfKanbanCard } from '@/components/kanban/SelfKanbanCard';
import { formatDuration } from '@/components/shipment/PhaseContextStrip';
import type { ITaskListItem, ShipmentPhase, TaskState } from '@/types';

const { Title, Text } = Typography;

// ─── Phase filter options ────────────────────────────────────────────────────

const PHASE_OPTIONS: ShipmentPhase[] = [
  'PLAN', 'PREP', 'DOCS', 'LOAD', 'TRANSIT', 'DEST', 'CLOSE',
];

// ─── Column definitions ──────────────────────────────────────────────────────

interface IColumnDef {
  key: string;
  states: TaskState[];
  accentColor: string;
  titleKey: string;
  emptyKey: string;
  /** Target task state when something is dropped here. Drops onto columns whose
   * target doesn't form a valid OPEN ↔ BLOCKED edge are rejected with a toast.
   * Every column accepts drops so the user gets feedback either way. */
  dropTargetState: 'open' | 'in_progress' | 'blocked' | 'done';
}

const COLUMNS: IColumnDef[] = [
  {
    key: 'todo',
    states: ['open'],
    accentColor: '#d9d9d9',
    titleKey: 'me.board.col_todo',
    emptyKey: 'me.board.empty_todo',
    dropTargetState: 'open',
  },
  {
    key: 'in_progress',
    states: ['in_progress'],
    accentColor: '#1677ff',
    titleKey: 'me.board.col_in_progress',
    emptyKey: 'me.board.empty_col',
    dropTargetState: 'in_progress',
  },
  {
    key: 'blocked',
    states: ['blocked'],
    accentColor: '#faad14',
    titleKey: 'me.board.col_blocked',
    emptyKey: 'me.board.empty_col',
    dropTargetState: 'blocked',
  },
  {
    key: 'done_today',
    states: ['done'],
    accentColor: '#52c41a',
    titleKey: 'me.board.col_done_today',
    emptyKey: 'me.board.empty_done_today',
    dropTargetState: 'done',
  },
];

// ─── KPI strip ───────────────────────────────────────────────────────────────

interface IKpiStripProps {
  doneCount: number;
  avgDurationSeconds: number;
  onTimeRate: number | null;
  isLoading: boolean;
}

function KpiStrip({ doneCount, avgDurationSeconds, onTimeRate, isLoading }: IKpiStripProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return <Skeleton.Input active style={{ width: 360, height: 20, marginBottom: 16 }} />;
  }

  const avgLabel =
    doneCount === 0 ? '—' : formatDuration(avgDurationSeconds);
  const onTimeLabel =
    onTimeRate == null ? '—' : `${Math.round(onTimeRate * 100)}%`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '8px 12px',
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <Space size={4}>
        <Badge color="#52c41a" />
        <Text style={{ fontSize: 13 }}>
          <Text strong>{doneCount}</Text>
          {' '}{t('me.kpi.done_today')}
        </Text>
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('me.kpi.avg_duration')}:
        </Text>
        <Text strong style={{ fontSize: 13 }}>{avgLabel}</Text>
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('me.kpi.on_time_rate')}:
        </Text>
        <Text strong style={{ fontSize: 13, color: onTimeRate == null ? undefined : onTimeRate >= 0.8 ? '#52c41a' : '#fa8c16' }}>
          {onTimeLabel}
        </Text>
      </Space>
    </div>
  );
}

// ─── Block modal ─────────────────────────────────────────────────────────────

interface IBlockModalProps {
  taskId: number | null;
  shipmentId: number | null;
  onClose: () => void;
}

function BlockModal({ taskId, shipmentId, onClose }: IBlockModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ reason: string }>();
  const blockTask = useBlockTask();

  function handleOk() {
    form
      .validateFields()
      .then(({ reason }) => {
        if (taskId == null || shipmentId == null) return;
        blockTask.mutate(
          { taskId, shipmentId, reason },
          {
            onSuccess: () => {
              form.resetFields();
              onClose();
              toast.success(t('me.board.toast_blocked'));
            },
          },
        );
      })
      .catch(() => undefined);
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

  return (
    <Modal
      open={taskId != null}
      title={t('me.board.block_modal_title')}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={blockTask.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="reason"
          label={t('me.board.block_modal_reason')}
          rules={[
            { required: true, message: t('me.board.block_modal_required') },
            { min: 3, message: t('me.board.block_modal_required') },
          ]}
        >
          <Input.TextArea rows={3} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─── SelfBoard ───────────────────────────────────────────────────────────────

/**
 * D2 — per-role "My Work" kanban at /me/board.
 * Shows current user's tasks from /api/v1/me/tasks/ in 4 columns.
 * Polls every 30 s via useMyTasks().
 */
export default function SelfBoard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: tasksData, isLoading: tasksLoading, isError: tasksError } = useMyTasks();
  const { data: kpi, isLoading: kpiLoading } = useMyKpiToday();
  const unblockTask = useUnblockTask();

  // Block modal state
  const [blockTarget, setBlockTarget] = useState<{
    taskId: number;
    shipmentId: number;
  } | null>(null);

  // Filters
  const [phaseFilter, setPhaseFilter] = useState<ShipmentPhase | null>(null);
  const [searchText, setSearchText] = useState('');
  const [showAll, setShowAll] = useState(false);

  const todayMidnight = dayjs().tz(TM_TZ).startOf('day').toISOString();

  // ── Derived task lists ───────────────────────────────────────────────────

  const allTasks: ITaskListItem[] = tasksData?.results ?? [];

  const filteredTasks = allTasks.filter((task) => {
    if (phaseFilter && task.phase !== phaseFilter) return false;
    if (
      searchText &&
      !task.shipment_cargo_code.toLowerCase().includes(searchText.toLowerCase())
    )
      return false;
    return true;
  });

  function tasksForColumn(col: IColumnDef): ITaskListItem[] {
    if (col.key === 'done_today') {
      return filteredTasks.filter(
        (t) =>
          t.state === 'done' &&
          t.completed_at != null &&
          t.completed_at >= todayMidnight,
      );
    }
    return filteredTasks.filter((t) => col.states.includes(t.state));
  }

  /** History column tasks: done (not today) + cancelled */
  const historyTasks = filteredTasks.filter(
    (t) =>
      t.state === 'cancelled' ||
      (t.state === 'done' &&
        (t.completed_at == null || t.completed_at < todayMidnight)),
  );

  // ── Drag and drop handlers ───────────────────────────────────────────────

  const handleDropOnColumn = useCallback(
    (e: React.DragEvent, targetState: 'open' | 'in_progress' | 'blocked' | 'done') => {
      e.preventDefault();
      const taskIdStr = e.dataTransfer.getData('task_id');
      const fromState = e.dataTransfer.getData('task_state') as TaskState;
      const taskId = parseInt(taskIdStr, 10);
      if (isNaN(taskId)) return;

      const task = allTasks.find((t) => t.id === taskId);
      if (!task) return;

      // Drop on same column — nothing to do
      if (fromState === targetState) return;

      // Allowed moves: open ↔ blocked (open→blocked opens modal; blocked→in_progress is unblock).
      // Every other transition either happens server-side via field edits or is
      // forbidden by design — surface a toast so the user knows the drag was seen.
      if (targetState === 'blocked' && fromState === 'open') {
        setBlockTarget({ taskId, shipmentId: task.shipment });
        return;
      }
      if (targetState === 'in_progress' && fromState === 'blocked') {
        unblockTask.mutate(
          { taskId, shipmentId: task.shipment },
          {
            onSuccess: () => toast.success(t('me.board.toast_unblocked')),
          },
        );
        return;
      }

      // All other combinations: noop with a small informational toast.
      toast.info(t('me.board.drop_not_allowed'));
    },
    [allTasks, unblockTask, t],
  );

  // ── Loading / error states ───────────────────────────────────────────────

  if (tasksError) {
    return (
      <Alert type="error" message={t('common.error')} style={{ margin: 24 }} />
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const openCount = allTasks.filter((t) => t.state === 'open').length;

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          {t('me.board.title')}
        </Title>
        {user && (
          <Text type="secondary" style={{ fontSize: 14 }}>
            {user.first_name || user.username}
          </Text>
        )}
        {openCount > 0 && (
          <Tag color="blue" style={{ marginLeft: 4 }}>
            {openCount}
          </Tag>
        )}
      </div>

      {/* KPI strip */}
      <KpiStrip
        doneCount={kpi?.done_count ?? 0}
        avgDurationSeconds={kpi?.avg_duration_seconds ?? 0}
        onTimeRate={kpi?.on_time_rate ?? null}
        isLoading={kpiLoading}
      />

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <Select<ShipmentPhase | null>
          value={phaseFilter}
          onChange={(v) => setPhaseFilter(v)}
          allowClear
          placeholder={t('me.board.filter_phase')}
          style={{ width: 140 }}
          options={[
            ...PHASE_OPTIONS.map((p) => ({
              value: p,
              label: t(`phase.${p.toLowerCase()}`),
            })),
          ]}
        />
        <Input
          placeholder={t('me.board.search_shipment')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          style={{ width: 200 }}
        />
        <Tooltip title={showAll ? t('me.board.show_today_only') : t('me.board.show_all')}>
          <Space size={6}>
            <Switch
              size="small"
              checked={showAll}
              onChange={setShowAll}
            />
            <Text style={{ fontSize: 13 }}>{t('me.board.show_all')}</Text>
          </Space>
        </Tooltip>
      </div>

      {/* Kanban columns */}
      {tasksLoading ? (
        <div style={{ display: 'flex', gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                minWidth: 240,
                background: '#fafafa',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <Skeleton active paragraph={{ rows: 3 }} />
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 16,
            alignItems: 'flex-start',
          }}
        >
          {COLUMNS.map((col) => {
            const colTasks = tasksForColumn(col);
            return (
              <KanbanColumn
                key={col.key}
                title={t(col.titleKey)}
                count={colTasks.length}
                accentColor={col.accentColor}
                emptyText={t(col.emptyKey)}
                onDrop={(e) => handleDropOnColumn(e, col.dropTargetState)}
              >
                {colTasks.map((task) => (
                  <SelfKanbanCard key={task.id} task={task} />
                ))}
              </KanbanColumn>
            );
          })}

          {/* History column — only visible when "Show all" is on */}
          {showAll && (
            <KanbanColumn
              key="history"
              title={t('me.board.col_history')}
              count={historyTasks.length}
              accentColor="#d9d9d9"
              emptyText={t('me.board.empty_col')}
            >
              {historyTasks.map((task) => (
                <SelfKanbanCard key={task.id} task={task} />
              ))}
            </KanbanColumn>
          )}
        </div>
      )}

      {/* Block reason modal */}
      <BlockModal
        taskId={blockTarget?.taskId ?? null}
        shipmentId={blockTarget?.shipmentId ?? null}
        onClose={() => setBlockTarget(null)}
      />
    </div>
  );
}
