import { Button, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { GateAction } from '@/hooks/useGate';
import type { IGateRow } from '@/types';
import { COLORS } from '@/constants/styles';

dayjs.extend(utc);
dayjs.extend(timezone);
const TM_TZ = 'Asia/Ashgabat';
const { Text } = Typography;

interface IGateTruckCardProps {
  readonly row: IGateRow;
  readonly primaryAction?: 'arrive' | 'depart';
  readonly undoAction?: 'undo_arrive' | 'undo_depart';
  readonly muted?: boolean;
  readonly onAction: (row: IGateRow, action: GateAction) => void;
}

/** One truck at the gate, sized for a phone: plate first, one big button. */
export function GateTruckCard({ row, primaryAction, undoAction, muted = false, onAction }: IGateTruckCardProps) {
  const { t } = useTranslation();
  const today = dayjs().tz(TM_TZ).format('YYYY-MM-DD');
  const overdue = row.date < today;

  return (
    <div
      data-testid={`gate-card-${row.id}`}
      style={{
        background: COLORS.white,
        border: `1px solid ${COLORS.borderLight}`,
        borderRadius: 10,
        padding: 14,
        marginBottom: 12,
        opacity: muted ? 0.55 : 1,
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1, lineHeight: 1.2 }}>
        {row.truck_plate ?? row.shipment_code}
      </div>
      {row.truck_plate_2 && <div style={{ fontSize: 18, fontWeight: 600 }}>{row.truck_plate_2}</div>}
      <Space wrap size={6} style={{ marginTop: 6 }}>
        <Text type={overdue ? 'danger' : 'secondary'}>
          {dayjs(row.date).format('DD.MM.YYYY')}{overdue ? ` · ${t('gate.overdue')}` : ''}
        </Text>
        {row.is_gapy_satys && <Tag color="purple">{t('gate.gapy')}</Tag>}
        <Tag>{t(`shipment_status.${row.status_code}`, { defaultValue: row.status_code })}</Tag>
      </Space>
      {(row.driver_name || row.driver_phone) && (
        <div style={{ marginTop: 6, fontSize: 16 }}>
          {row.driver_name}{' '}
          {row.driver_phone && <a href={`tel:${row.driver_phone}`}>{row.driver_phone}</a>}
        </div>
      )}
      {primaryAction && (
        <Button
          type="primary"
          size="large"
          block
          onClick={() => onAction(row, primaryAction)}
          style={{ height: 56, fontSize: 18, marginTop: 12 }}
        >
          {t(`gate.${primaryAction}`)}
        </Button>
      )}
      {undoAction && row.can_undo && (
        <Button size="large" block onClick={() => onAction(row, undoAction)} style={{ marginTop: 8 }}>
          {t('gate.undo')}
        </Button>
      )}
    </div>
  );
}
