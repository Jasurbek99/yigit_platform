import { Tag, Typography } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ITaskListItem } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IPlanTaskCardProps {
  readonly task: ITaskListItem;
}

/**
 * Compact card for `kind === 'weekly_plan'` tasks on the SelfBoard.
 * Clicking navigates to the weekly plan grid filtered to the task's week/year.
 * Done tasks are visually de-emphasized (reduced opacity, muted border).
 */
export function PlanTaskCard({ task }: IPlanTaskCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isDone = task.state === 'done' || task.state === 'cancelled';
  const borderColor = isDone ? COLORS.borderLight : COLORS.primary;

  function handleClick() {
    navigate(task.link);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }

  const weekLabel =
    task.scope_week != null && task.scope_year != null
      ? `W${task.scope_week}/${task.scope_year}`
      : null;

  const blockLabel = task.scope_block_code;
  const stateLabel = t(`tasks.state.${task.state}`);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`${t(task.title_key)}${blockLabel ? ` ${blockLabel}` : ''}${weekLabel ? ` ${weekLabel}` : ''}, ${stateLabel}`}
      style={{
        background: COLORS.white,
        border: '1px solid #f0f0f0',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 6,
        padding: '8px 10px',
        cursor: 'pointer',
        userSelect: 'none',
        opacity: isDone ? 0.55 : 1,
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
      {/* Row 1: title + calendar icon */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <CalendarOutlined style={{ color: COLORS.primary, fontSize: 12 }} />
        <Text
          strong
          style={{ fontSize: 12, flex: 1, minWidth: 0 }}
          ellipsis={{ tooltip: t(task.title_key) }}
        >
          {t(task.title_key)}
        </Text>
        {blockLabel && (
          <Tag
            color="blue"
            style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}
          >
            {blockLabel}
          </Tag>
        )}
      </div>

      {/* Row 2: week label + state tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {weekLabel && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {weekLabel}
          </Text>
        )}
        <Tag
          color={isDone ? 'default' : 'processing'}
          style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}
        >
          {stateLabel}
        </Tag>
      </div>
    </div>
  );
}
