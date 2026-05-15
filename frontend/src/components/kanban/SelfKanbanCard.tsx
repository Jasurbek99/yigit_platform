import { Tag, Typography } from 'antd';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ITaskListItem, ShipmentPhase } from '@/types';
import { formatDuration } from '@/components/shipment/PhaseContextStrip.helpers';
import dayjs from 'dayjs';

const { Text } = Typography;

/** Accent colour for the phase tag */
const PHASE_TAG_COLOR: Record<ShipmentPhase, string> = {
  PLAN: 'default',
  PREP: 'orange',
  DOCS: 'gold',
  LOAD: 'blue',
  TRANSIT: 'cyan',
  DEST: 'purple',
  CLOSE: 'green',
};

/** Border-left colour by task state / overdue */
function getBorderColor(task: ITaskListItem): string {
  if (task.is_overdue) return '#ff4d4f';
  if (task.state === 'in_progress') return '#1677ff';
  if (task.state === 'blocked') return '#faad14';
  return '#d9d9d9';
}

interface IDeadlineTextProps {
  task: ITaskListItem;
}

function DeadlineText({ task }: IDeadlineTextProps) {
  const { t } = useTranslation();

  if (!task.deadline) {
    return (
      <Text type="secondary" style={{ fontSize: 11 }}>
        {t('common.no_deadline')}
      </Text>
    );
  }

  const deadline = dayjs(task.deadline);
  const now = dayjs();
  const diffSeconds = deadline.diff(now, 'second');

  if (task.is_overdue || diffSeconds < 0) {
    const overdueSecs = Math.abs(diffSeconds);
    return (
      <Text style={{ fontSize: 11, color: '#ff4d4f' }}>
        {t('me.board.overdue_by', { duration: formatDuration(overdueSecs) })}
      </Text>
    );
  }

  return (
    <Text type="secondary" style={{ fontSize: 11 }}>
      {t('me.board.due_in', { duration: formatDuration(diffSeconds) })}
    </Text>
  );
}

interface ISelfKanbanCardProps {
  task: ITaskListItem;
  onCardClick?: (task: ITaskListItem) => void;
}

/**
 * A draggable card for the Self Kanban board (/me/board).
 * Click opens the inline task drawer via `onCardClick`; if no handler is
 * provided it falls back to navigating to the shipment detail page.
 *
 * The `draggedRef` flag prevents the click handler from firing when the user
 * finishes a drag on the same card (browsers normally fire click after dragend,
 * though most do suppress it — the ref makes the guard explicit).
 */
export function SelfKanbanCard({ task, onCardClick }: ISelfKanbanCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const draggedRef = useRef(false);

  function handleDragStart(e: React.DragEvent) {
    draggedRef.current = true;
    e.dataTransfer.setData('task_id', String(task.id));
    e.dataTransfer.setData('task_state', task.state);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    // Reset after a short delay so the click event (if any) can check the flag.
    setTimeout(() => {
      draggedRef.current = false;
    }, 100);
  }

  function handleClick() {
    if (draggedRef.current) return;
    if (onCardClick) {
      onCardClick(task);
      return;
    }
    navigate(`/shipments/${task.shipment}`);
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      style={{
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderLeft: `3px solid ${getBorderColor(task)}`,
        borderRadius: 6,
        padding: '8px 10px',
        cursor: 'grab',
        userSelect: 'none',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          '0 2px 8px rgba(0,0,0,0.1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      {/* Row 1: cargo code + phase tag */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
          gap: 6,
        }}
      >
        <Text
          strong
          style={{ fontSize: 12, fontFamily: 'monospace', flex: 1, minWidth: 0 }}
          ellipsis
        >
          {task.shipment_cargo_code}
        </Text>
        <Tag
          color={PHASE_TAG_COLOR[task.phase]}
          style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}
        >
          {task.phase}
        </Tag>
      </div>

      {/* Row 2: task title */}
      <Text
        style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
        ellipsis={{ tooltip: t(task.title_key) }}
      >
        {t(task.title_key)}
      </Text>

      {/* Row 3: deadline indicator */}
      <DeadlineText task={task} />
    </div>
  );
}
