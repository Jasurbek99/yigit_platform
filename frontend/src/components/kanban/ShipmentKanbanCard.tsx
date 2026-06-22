import { Progress, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IBoardItem } from '@/hooks/useShipmentBoard';
import { formatDuration } from '@/components/shipment/PhaseContextStrip.helpers';
import { COLORS, FONT } from '@/constants/styles';

const { Text } = Typography;

/** Top border colour reflects the highest-priority alert on this shipment. */
function getBorderColor(item: IBoardItem): string {
  if (item.late_count > 0) return COLORS.danger;
  if (item.blocked_count > 0) return COLORS.warning;
  if (item.in_progress_count > 0) return COLORS.primary;
  return COLORS.borderLight;
}

interface IShipmentKanbanCardProps {
  item: IBoardItem;
  /** Open the task modal for this shipment — the user acts on tasks in place. */
  onTasksClick: (item: IBoardItem) => void;
}

/**
 * A non-draggable card for the Shipment Board (/export/shipments/board).
 * Clicking the card opens the task modal so the user can act on this shipment's
 * tasks without leaving the board (the detail page is reachable via a link in
 * the modal). Status changes still happen via transitions on the Detail page,
 * not by dragging here.
 */
export function ShipmentKanbanCard({ item, onTasksClick }: IShipmentKanbanCardProps) {
  const { t } = useTranslation();

  const progressPercent =
    item.tasks_total > 0 ? (item.tasks_done / item.tasks_total) * 100 : 0;

  const borderColor = getBorderColor(item);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onTasksClick(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTasksClick(item);
        }
      }}
      style={{
        background: COLORS.white,
        border: '1px solid #f0f0f0',
        borderTop: `3px solid ${borderColor}`,
        borderRadius: 6,
        padding: '8px 10px',
        cursor: 'pointer',
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
      {/* Row 1: shipment code */}
      <Text
        strong
        style={{ fontSize: 12, fontFamily: FONT.mono, display: 'block', marginBottom: 2 }}
        ellipsis
      >
        {item.shipment_code}
      </Text>

      {/* Row 2: owner role + time in phase */}
      {item.owner_role && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
          {t(`tasks.role.${item.owner_role}`)}
          {item.time_in_phase_seconds != null && (
            <> &middot; {formatDuration(item.time_in_phase_seconds)}</>
          )}
        </Text>
      )}

      {/* Rows 3+4: task progress bar + count label */}
      <Progress
        percent={progressPercent}
        size="small"
        showInfo={false}
        strokeColor={progressPercent === 100 ? COLORS.success : COLORS.primary}
        style={{ marginBottom: 2 }}
      />
      <Text type="secondary" style={{ fontSize: 11 }}>
        {t('shipment_board.tasks_progress', {
          done: item.tasks_done,
          total: item.tasks_total,
        })}
      </Text>
    </div>
  );
}
