import { Card } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDetail, TaskState } from '@/types';
import { formatDuration } from './PhaseContextStrip.helpers';

const ACTIVE_STATES: TaskState[] = ['open', 'in_progress', 'blocked'];

interface IPhaseContextStripProps {
  shipment: IShipmentDetail;
}

/**
 * Three info cells below MyTaskCard:
 * - Time in current phase
 * - Average time for phase (from analytics)
 * - Count of open/in-progress/blocked tasks across the shipment
 */
export function PhaseContextStrip({ shipment }: IPhaseContextStripProps) {
  const { t } = useTranslation();

  // Count all active tasks: my_task (if active) + other_tasks that are active
  const myTaskActive =
    shipment.my_task != null && ACTIVE_STATES.includes(shipment.my_task.state) ? 1 : 0;
  const otherActiveCount = shipment.other_tasks.filter((task) =>
    ACTIVE_STATES.includes(task.state),
  ).length;
  const totalActive = myTaskActive + otherActiveCount;
  const totalTasks =
    (shipment.my_task != null ? 1 : 0) + shipment.other_tasks.length;

  const cellStyle: React.CSSProperties = {
    flex: 1,
    padding: '12px 16px',
    textAlign: 'center' as const,
    minWidth: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#8c8c8c',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'monospace',
    color: '#262626',
  };

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 0 }}>
        {/* Cell 1: In phase */}
        <div style={cellStyle}>
          <div style={labelStyle}>{t('shipment.detail.in_phase')}</div>
          <div style={valueStyle}>{formatDuration(shipment.in_phase_seconds)}</div>
        </div>

        <div style={{ width: 1, background: '#f0f0f0', margin: '8px 0' }} />

        {/* Cell 2: Average for current step (per-status average; not phase-wide).
            phase_avg_seconds is computed per-status on the backend; the
            "avg for phase" framing was misleading because TRANSIT etc. cover
            multiple statuses. */}
        <div style={cellStyle}>
          <div style={labelStyle}>{t('shipment.detail.avg_for_step')}</div>
          <div style={valueStyle}>{formatDuration(shipment.phase_avg_seconds)}</div>
        </div>

        <div style={{ width: 1, background: '#f0f0f0', margin: '8px 0' }} />

        {/* Cell 3: Open tasks */}
        <div style={cellStyle}>
          <div style={labelStyle}>{t('shipment.detail.tasks_open')}</div>
          <div style={valueStyle}>
            {totalActive}
            <span style={{ fontSize: 14, fontWeight: 400, color: '#8c8c8c' }}>
              /{totalTasks}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
