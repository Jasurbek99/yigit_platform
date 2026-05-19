import { Dropdown, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useRef } from 'react';
import { IconDotsVertical } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ITaskListItem, ShipmentPhase, TaskState } from '@/types';
import { formatDuration } from '@/components/shipment/PhaseContextStrip.helpers';
import dayjs from 'dayjs';

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

function getBorderColor(task: ITaskListItem): string {
  if (task.is_overdue) return '#ff4d4f';
  if (task.state === 'in_progress') return '#1677ff';
  if (task.state === 'blocked') return '#faad14';
  return '#d9d9d9';
}

/**
 * Allowed manual moves for the keyboard menu — must mirror the drop handler
 * in SelfBoard so both interaction modes stay in sync. Other transitions
 * happen server-side via task field edits, not via column moves.
 */
function getAllowedMoves(state: TaskState): TaskState[] {
  if (state === 'open') return ['blocked'];
  if (state === 'blocked') return ['in_progress'];
  return [];
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
  /** Keyboard-equivalent for the drag-and-drop column move. Receives the
   * target state from the dropdown menu. Caller routes it through the same
   * logic as the column-drop handler so behaviour stays consistent. */
  onMove?: (task: ITaskListItem, targetState: TaskState) => void;
}

/**
 * A draggable card for the Self Kanban board (/me/board).
 *
 * Two interaction modes:
 * - Mouse: click opens the inline task drawer; drag onto a column moves it.
 * - Keyboard: Tab focuses the card body; Enter/Space opens the drawer. If
 *   the task has any allowed moves, an ellipsis menu button is rendered
 *   in the top-right — Tab focuses it, Enter opens the menu, arrow keys
 *   pick a move, Enter applies it.
 *
 * `draggedRef` prevents the click handler from firing when the user
 * finishes a drag on the same card (browsers fire click after dragend on
 * some platforms).
 */
export function SelfKanbanCard({ task, onCardClick, onMove }: ISelfKanbanCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const draggedRef = useRef(false);

  const allowedMoves = getAllowedMoves(task.state);
  const stateLabel = t(`tasks.state.${task.state}`);
  const titleLabel = t(task.title_key);

  function handleDragStart(e: React.DragEvent) {
    draggedRef.current = true;
    e.dataTransfer.setData('task_id', String(task.id));
    e.dataTransfer.setData('task_state', task.state);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    setTimeout(() => {
      draggedRef.current = false;
    }, 100);
  }

  function openTask() {
    if (draggedRef.current) return;
    if (onCardClick) {
      onCardClick(task);
      return;
    }
    navigate(`/shipments/${task.shipment}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Only handle keys when the card body itself has focus — let
    // descendants (like the dropdown trigger) own their own keys.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTask();
    }
  }

  const menuItems: MenuProps['items'] = allowedMoves.map((target) => ({
    key: target,
    label:
      target === 'blocked'
        ? t('me.board.action_mark_blocked')
        : t('me.board.action_unblock'),
  }));

  function handleMenuClick({ key }: { key: string }) {
    if (onMove) onMove(task, key as TaskState);
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={openTask}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={t('me.board.card_aria', { title: titleLabel, state: stateLabel })}
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
      {/* Row 1: cargo code + phase tag + move menu */}
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
        {allowedMoves.length > 0 && onMove && (
          <Dropdown
            menu={{ items: menuItems, onClick: handleMenuClick }}
            trigger={['click']}
            placement="bottomRight"
          >
            <button
              type="button"
              aria-label={t('me.board.action_menu')}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // Stop Enter/Space from bubbling so the card's keydown
                // doesn't also open the drawer. The Dropdown handles
                // opening the menu itself.
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: '#8c8c8c',
                borderRadius: 4,
              }}
            >
              <IconDotsVertical size={14} />
            </button>
          </Dropdown>
        )}
      </div>

      {/* Row 2: task title */}
      <Text
        style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
        ellipsis={{ tooltip: titleLabel }}
      >
        {titleLabel}
      </Text>

      {/* Row 3: deadline indicator */}
      <DeadlineText task={task} />
    </div>
  );
}
