import { Progress, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
}

/**
 * A non-draggable card for the Shipment Board (/export/shipments/board).
 * Clicking navigates to the shipment detail page.
 * Cards in this board are deliberately read-only — status changes happen
 * via transitions on the Detail page, not by dragging here.
 */
export function ShipmentKanbanCard({ item }: IShipmentKanbanCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const progressPercent =
    item.tasks_total > 0 ? (item.tasks_done / item.tasks_total) * 100 : 0;

  const borderColor = getBorderColor(item);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/shipments/${item.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(`/shipments/${item.id}`);
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
      {/* Row 1: cargo code */}
      <Text
        strong
        style={{ fontSize: 12, fontFamily: FONT.mono, display: 'block', marginBottom: 2 }}
        ellipsis
      >
        {item.cargo_code}
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

      {/* Row 3: task progress bar */}
      <Progress
        percent={progressPercent}
        size="small"
        showInfo={false}
        strokeColor={progressPercent === 100 ? COLORS.success : COLORS.primary}
        style={{ marginBottom: 2 }}
      />

      {/* Row 4: task count label */}
      <Text type="secondary" style={{ fontSize: 11 }}>
        {t('shipment_board.tasks_progress', {
          done: item.tasks_done,
          total: item.tasks_total,
        })}
      </Text>
    </div>
  );
}
