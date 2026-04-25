import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Card, Loader, SegmentedControl, Text } from '@mantine/core';
import { IconAlertTriangle, IconClock } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useShipments, useMyPendingCount } from '@/hooks/useShipments';
import { useAuth } from '@/hooks/useAuth';
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

// Required fields per role — mirrors backend ROLE_REQUIRED_FIELDS.
// Used to show "missing field" chips on My Tasks cards.
const ROLE_REQUIRED_FIELDS: Record<string, { field: string; labelKey: string }[]> = {
  warehouse_chief: [
    { field: 'weight_net', labelKey: 'kanban.field_weight' },
    { field: 'weight_gross', labelKey: 'kanban.field_weight_gross' },
    { field: 'variety_name', labelKey: 'kanban.field_variety' },
    { field: 'harvest_status', labelKey: 'kanban.field_harvest' },
  ],
  document_team: [
    { field: 'documents_status', labelKey: 'kanban.field_documents' },
  ],
  transport: [
    { field: 'truck_head_id', labelKey: 'kanban.field_truck' },
    { field: 'driver_id', labelKey: 'kanban.field_driver' },
    { field: 'border_point_name', labelKey: 'kanban.field_border' },
  ],
  sales_rep: [
    { field: 'city_name', labelKey: 'kanban.field_city' },
    { field: 'price_per_kg', labelKey: 'kanban.field_price' },
    { field: 'total_amount_usd', labelKey: 'kanban.field_total' },
  ],
  finansist: [
    { field: 'price_per_kg', labelKey: 'kanban.field_price' },
    { field: 'total_amount_usd', labelKey: 'kanban.field_total' },
  ],
};

function getMissingFields(
  shipment: IShipmentListItem,
  role: string | undefined,
): { field: string; labelKey: string }[] {
  if (!role) return [];
  const required = ROLE_REQUIRED_FIELDS[role];
  if (!required) return [];
  return required.filter((r) => {
    const val = shipment[r.field as keyof IShipmentListItem];
    return val === null || val === undefined || val === '';
  });
}

interface IShipmentCardProps {
  shipment: IShipmentListItem;
  phase: string;
  showMissing?: boolean;
  userRole?: string;
}

function ShipmentCard({ shipment, phase, showMissing, userRole }: IShipmentCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const days = daysAgo(shipment.updated_at);
  const isOverdue = days >= OVERDUE_DAYS[phase];
  const missing = showMissing ? getMissingFields(shipment, userRole) : [];

  return (
    <Card
      padding="xs"
      style={{
        marginBottom: 8,
        borderLeft: isOverdue ? '3px solid #ff4d4f' : showMissing ? '3px solid #1677ff' : '3px solid transparent',
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
      {missing.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {missing.map((m) => (
            <Badge key={m.field} variant="light" color="blue" size="xs">
              {t(m.labelKey)}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

interface IKanbanColumnViewProps {
  column: IKanbanColumn;
  myTasks?: boolean;
  userRole?: string;
  onOverdueCount?: (phase: string, count: number) => void;
}

function KanbanColumnView({ column, myTasks, userRole, onOverdueCount }: IKanbanColumnViewProps) {
  const { t } = useTranslation();
  const filters = myTasks
    ? { phase: column.phase, pending_my_fields: true, page_size: 100 }
    : { phase: column.phase, page_size: 100 };
  const { data, isLoading } = useShipments(filters);
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
            {myTasks ? t('kanban.no_pending') : t('kanban.no_shipments')}
          </Text>
        )}
        {shipments.map((s) => (
          <ShipmentCard
            key={s.id}
            shipment={s}
            phase={column.phase}
            showMissing={myTasks}
            userRole={userRole}
          />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: pendingCount } = useMyPendingCount();
  const [mode, setMode] = useState<string>('all');
  const [overdueByPhase, setOverdueByPhase] = useState<Record<string, number>>({});
  const isMyTasks = mode === 'my_tasks';

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
            {t('kanban.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            data={[
              { label: t('kanban.all_shipments'), value: 'all' },
              {
                label: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t('kanban.my_tasks')}
                    {(pendingCount ?? 0) > 0 && (
                      <Badge size="xs" color="blue" variant="filled">{pendingCount}</Badge>
                    )}
                  </div>
                ),
                value: 'my_tasks',
              },
            ]}
            size="sm"
          />
        </div>
      </div>

      {totalOverdue > 0 && !isMyTasks && (
        <Alert color="yellow" mb="md" withCloseButton>
          {t('kanban.overdue_banner', { count: totalOverdue })}
        </Alert>
      )}

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, WebkitOverflowScrolling: 'touch' }}>
        {COLUMNS.map((col) => (
          <KanbanColumnView
            key={`${col.phase}-${mode}`}
            column={col}
            myTasks={isMyTasks}
            userRole={user?.role}
            onOverdueCount={handleOverdueCount}
          />
        ))}
      </div>
    </div>
  );
}
