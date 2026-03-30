import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, Spin, Tag, Typography, Alert } from 'antd';
import { ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useShipments } from '@/hooks/useShipments';
import { StatusTag } from '@/components/StatusTag';
import type { IShipmentListItem } from '@/types';

const { Text } = Typography;

// Days threshold before a shipment is considered overdue per phase
const OVERDUE_DAYS: Record<string, number> = {
  LOADING: 2,
  CUSTOMS: 2,
  TRANSIT: 5,
  BORDER: 3,
  SALES: 10,
};

interface IKanbanColumn {
  phase: string;
  labelKey: string;
  color: string;
}

const COLUMNS: IKanbanColumn[] = [
  { phase: 'LOADING', labelKey: 'kanban.phase_loading', color: '#1677ff' },
  { phase: 'CUSTOMS', labelKey: 'kanban.phase_customs', color: '#fa8c16' },
  { phase: 'TRANSIT', labelKey: 'kanban.phase_transit', color: '#13c2c2' },
  { phase: 'BORDER', labelKey: 'kanban.phase_border', color: '#722ed1' },
  { phase: 'SALES', labelKey: 'kanban.phase_sales', color: '#52c41a' },
];

function daysAgo(iso: string): number {
  return dayjs().diff(dayjs(iso), 'day');
}

interface IShipmentCardProps {
  shipment: IShipmentListItem;
  phase: string;
}

function ShipmentCard({ shipment, phase }: IShipmentCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const days = daysAgo(shipment.updated_at);
  const isOverdue = days >= OVERDUE_DAYS[phase];

  return (
    <Card
      size="small"
      hoverable
      onClick={() => navigate(`/shipments/${shipment.id}`)}
      style={{
        marginBottom: 8,
        borderLeft: isOverdue ? '3px solid #ff4d4f' : '3px solid transparent',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text strong style={{ fontSize: 13 }}>{shipment.cargo_code}</Text>
        {isOverdue && (
          <Tag icon={<WarningOutlined />} color="error" style={{ margin: 0, fontSize: 11 }}>
            {t('kanban.overdue')}
          </Tag>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{shipment.customer_name ?? '—'}</Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, alignItems: 'center' }}>
        <StatusTag statusDisplay={shipment.status_display} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {shipment.weight_net != null && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('kanban.weight', { weight: Number(shipment.weight_net).toLocaleString() })}
            </Text>
          )}
          <Text
            type={isOverdue ? 'danger' : 'secondary'}
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <ClockCircleOutlined />
            {t('kanban.days_stuck', { count: days })}
          </Text>
        </div>
      </div>
    </Card>
  );
}

interface IKanbanColumnViewProps {
  column: IKanbanColumn;
  onOverdueCount?: (phase: string, count: number) => void;
}

function KanbanColumnView({ column, onOverdueCount }: IKanbanColumnViewProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useShipments({ phase: column.phase, page_size: 100 });
  const shipments = data?.results ?? [];
  const overdueCount = shipments.filter((s) => daysAgo(s.updated_at) >= OVERDUE_DAYS[column.phase]).length;

  useEffect(() => {
    if (!isLoading) {
      onOverdueCount?.(column.phase, overdueCount);
    }
  }, [overdueCount, isLoading, column.phase, onOverdueCount]);

  return (
    <div
      style={{
        flex: '0 0 240px',
        background: '#f5f5f5',
        borderRadius: 8,
        padding: '10px 8px',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 140px)',
      }}
    >
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 4px' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
        <Text strong style={{ fontSize: 13 }}>{t(column.labelKey)}</Text>
        <Badge
          count={data?.count ?? 0}
          style={{ backgroundColor: column.color, marginLeft: 'auto' }}
          showZero
        />
        {overdueCount > 0 && (
          <Badge count={overdueCount} style={{ backgroundColor: '#ff4d4f' }} />
        )}
      </div>

      {/* Cards */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <Spin size="small" />
          </div>
        )}
        {!isLoading && shipments.length === 0 && (
          <Text type="secondary" style={{ fontSize: 12, padding: '8px 4px', display: 'block' }}>
            {t('kanban.no_shipments')}
          </Text>
        )}
        {shipments.map((s) => (
          <ShipmentCard key={s.id} shipment={s} phase={column.phase} />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard() {
  const { t } = useTranslation();
  const [overdueByPhase, setOverdueByPhase] = useState<Record<string, number>>({});

  const handleOverdueCount = (phase: string, count: number) => {
    setOverdueByPhase((prev) => {
      if (prev[phase] === count) return prev;
      return { ...prev, [phase]: count };
    });
  };

  const totalOverdue = Object.values(overdueByPhase).reduce((sum, n) => sum + n, 0);

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 12 }}>
        {t('kanban.title')}
      </Typography.Title>

      {totalOverdue > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('kanban.overdue_banner', { count: totalOverdue })}
          style={{ marginBottom: 16 }}
          closable
        />
      )}

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
        {COLUMNS.map((col) => (
          <KanbanColumnView key={col.phase} column={col} onOverdueCount={handleOverdueCount} />
        ))}
      </div>
    </div>
  );
}
