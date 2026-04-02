import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Card, Loader, Text } from '@mantine/core';
import { IconAlertTriangle, IconClock } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useShipments } from '@/hooks/useShipments';
import { StatusTag } from '@/components/StatusTag';
import type { IShipmentListItem } from '@/types';

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
      padding="xs"
      style={{
        marginBottom: 8,
        borderLeft: isOverdue ? '3px solid #ff4d4f' : '3px solid transparent',
        cursor: 'pointer',
      }}
      onClick={() => navigate(`/shipments/${shipment.id}`)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text fw={600} size="sm">{shipment.cargo_code}</Text>
        {isOverdue && (
          <Badge
            variant="light"
            color="red"
            size="xs"
            leftSection={<IconAlertTriangle size={10} />}
          >
            {t('kanban.overdue')}
          </Badge>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        <Text c="dimmed" size="xs">{shipment.customer_name ?? '—'}</Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, alignItems: 'center' }}>
        <StatusTag statusDisplay={shipment.status_display} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {shipment.weight_net != null && (
            <Text c="dimmed" size="xs">
              {t('kanban.weight', { weight: Number(shipment.weight_net).toLocaleString() })}
            </Text>
          )}
          <Text
            c={isOverdue ? 'red' : 'dimmed'}
            size="xs"
            style={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <IconClock size={11} style={{ display: 'inline' }} />
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
        flex: '0 0 280px',
        minWidth: 250,
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
        <Text fw={600} size="sm">{t(column.labelKey)}</Text>
        <Badge
          style={{ backgroundColor: column.color, marginLeft: 'auto' }}
          size="sm"
        >
          {data?.count ?? 0}
        </Badge>
        {overdueCount > 0 && (
          <Badge color="red" size="sm">{overdueCount}</Badge>
        )}
      </div>

      {/* Cards */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <Loader size="sm" />
          </div>
        )}
        {!isLoading && shipments.length === 0 && (
          <Text c="dimmed" size="xs" style={{ padding: '8px 4px', display: 'block' }}>
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
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3' }}>
            {t('kanban.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Häzirki hereket edýän ýükleriň ýagdaýy — Kanban görnüşi
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* action buttons */}
        </div>
      </div>

      {totalOverdue > 0 && (
        <Alert color="yellow" mb="md" withCloseButton>
          {t('kanban.overdue_banner', { count: totalOverdue })}
        </Alert>
      )}

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, WebkitOverflowScrolling: 'touch' }}>
        {COLUMNS.map((col) => (
          <KanbanColumnView key={col.phase} column={col} onOverdueCount={handleOverdueCount} />
        ))}
      </div>
    </div>
  );
}
