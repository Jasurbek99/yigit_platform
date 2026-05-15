import { useState } from 'react';
import {
  Table,
  DatePicker,
  Tag,
  Skeleton,
  Alert,
  Flex,
  Typography,
  InputNumber,
  Button,
  Space,
  Tooltip,
  Statistic,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { toast } from 'sonner';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import {
  useLocalSellPlans,
  useUpsertLocalSellPlan,
  useInitializeLocalSellWeek,
  useBulkSubmitLocalSellPlans,
  useBulkApproveLocalSellPlans,
} from '@/hooks/usePlanning';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import type { IWeeklyLocalSellPlan, PlanStatus } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Text } = Typography;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type Day = (typeof DAYS)[number];

const DAY_INDEX: Record<Day, number> = {
  monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const STATUS_TAG: Record<PlanStatus, { color: string; icon: React.ReactNode }> = {
  draft: { color: 'default', icon: <EditOutlined /> },
  submitted: { color: 'processing', icon: <ClockCircleOutlined /> },
  approved: { color: 'success', icon: <CheckCircleOutlined /> },
  rejected: { color: 'error', icon: <CloseCircleOutlined /> },
};

function num(val: unknown): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

function fmtKg(val: number | string | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

// ─── Cell component ──────────────────────────────────────────────────────────

function PlanCell({ day, row, editable, lockedEditable, onSave }: {
  day: Day; row: IWeeklyLocalSellPlan; editable: boolean; lockedEditable: boolean;
  onSave: (row: IWeeklyLocalSellPlan, day: Day, value: number) => void;
}) {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState(false);
  const field = `${day}_plan_kg` as keyof IWeeklyLocalSellPlan;
  const value = num(row[field]);

  if (editable || (lockedEditable && unlocked)) {
    return (
      <InputNumber
        min={0} step={100} keyboard={false} defaultValue={value}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(/,/g, '')) || 0;
          if (v !== value) onSave(row, day, v);
          if (lockedEditable) setUnlocked(false);
        }}
        onKeyDown={handleCellKeyDown}
        size="small" style={{ width: 84 }}
        autoFocus={lockedEditable && unlocked}
      />
    );
  }

  // Locked but double-clickable for admin
  if (lockedEditable) {
    return (
      <span
        onDoubleClick={() => setUnlocked(true)}
        style={{ cursor: 'pointer' }}
        title={t('local_sell.double_click_hint')}
      >
        {fmtKg(value)}
      </span>
    );
  }

  return <span>{fmtKg(value)}</span>;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function LocalSellPlanGrid() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const role = user?.role;
  const canEdit = canDo(user, 'local_sell_plan', 'edit');
  const isManager = role === 'export_manager' || role === 'director';

  const [selectedWeek, setSelectedWeek] = useState<Dayjs | null>(dayjs());

  const weekNumber = selectedWeek?.isoWeek();
  const year = selectedWeek?.isoWeekYear();

  const { data: seasonsData } = useSeasons();
  const activeSeason = seasonsData?.find((s) => s.is_active);

  const { data, isLoading, isError } = useLocalSellPlans({ year, week: weekNumber });
  const upsert = useUpsertLocalSellPlan();
  const initWeek = useInitializeLocalSellWeek();
  const bulkSubmit = useBulkSubmitLocalSellPlans();
  const bulkApprove = useBulkApproveLocalSellPlans();

  const plans = data?.results ?? [];
  const today = dayjs();
  const isCurrentOrFuture = selectedWeek
    ? selectedWeek.isoWeekYear() > today.isoWeekYear() ||
      (selectedWeek.isoWeekYear() === today.isoWeekYear() && selectedWeek.isoWeek() >= today.isoWeek())
    : false;

  const statusCounts = plans.reduce<Record<PlanStatus, number>>(
    (acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; },
    { draft: 0, submitted: 0, approved: 0, rejected: 0 },
  );

  const totalPlan = plans.reduce((s, p) => s + num(p.total_plan_kg), 0);

  function handleSave(row: IWeeklyLocalSellPlan, day: Day, value: number) {
    upsert.mutate({ id: row.id, [`${day}_plan_kg`]: value }, {
      onError: () => toast.error(t('local_sell.save_error')),
    });
  }

  function handleInitWeek() {
    if (!weekNumber || !year) return;
    initWeek.mutate(
      { week_number: weekNumber, year, season: activeSeason?.id },
      { onSuccess: (d) => toast.success(t('local_sell.init_success', { count: d.count })) },
    );
  }

  function handleBulkSubmit() {
    const ids = plans.filter((p) => p.status === 'draft' || p.status === 'rejected').map((p) => p.id);
    if (!ids.length) return;
    bulkSubmit.mutate(ids, { onSuccess: () => toast.success(t('local_sell.submitted')) });
  }

  function handleBulkApprove() {
    const ids = plans.filter((p) => p.status === 'submitted').map((p) => p.id);
    if (!ids.length) return;
    bulkApprove.mutate(ids, { onSuccess: () => toast.success(t('local_sell.approved')) });
  }

  function dayDate(day: Day): Dayjs | null {
    if (!selectedWeek) return null;
    return selectedWeek.startOf('isoWeek').add(DAY_INDEX[day] - 1, 'day');
  }

  const columns: TableColumnsType<IWeeklyLocalSellPlan> = [
    {
      title: t('local_sell.firm'),
      dataIndex: 'export_firm_name',
      width: 160,
      fixed: 'left',
      render: (v: string) => <Text strong>{v || '—'}</Text>,
    },
    ...DAYS.map((day) => {
      const dd = dayDate(day);
      const dayLabel = dd ? dd.format('dd D') : day;
      return {
        title: dayLabel,
        key: `${day}_plan`,
        width: 95,
        align: 'center' as const,
        render: (_: unknown, row: IWeeklyLocalSellPlan) => {
          const normalEdit = canEdit && (row.status === 'draft' || row.status === 'rejected');
          const lockedEdit = isManager && (row.status === 'approved' || row.status === 'submitted');
          return <PlanCell day={day} row={row} editable={normalEdit} lockedEditable={lockedEdit} onSave={handleSave} />;
        },
      };
    }),
    {
      title: t('local_sell.total'),
      key: 'total_plan',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, row: IWeeklyLocalSellPlan) => <Text strong>{fmtKg(row.total_plan_kg)}</Text>,
    },
    {
      title: t('local_sell.status'),
      dataIndex: 'status',
      width: 110,
      fixed: 'right',
      render: (status: PlanStatus, row: IWeeklyLocalSellPlan) => {
        const s = STATUS_TAG[status];
        return (
          <Tooltip title={status === 'rejected' ? row.rejection_note : undefined}>
            <Tag color={s.color} icon={s.icon}>{t(`local_sell.status_${status}`)}</Tag>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div>
      {/* Week picker toolbar */}
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Space>
          <Button icon={<LeftOutlined />} onClick={() => setSelectedWeek((w) => w?.subtract(1, 'week') ?? dayjs())} />
          <DatePicker
            picker="week"
            value={selectedWeek}
            onChange={(v) => setSelectedWeek(v)}
            allowClear={false}
            style={{ width: 180 }}
          />
          <Button icon={<RightOutlined />} onClick={() => setSelectedWeek((w) => w?.add(1, 'week') ?? dayjs())} />
          <Text type="secondary">
            W{weekNumber}/{year}
          </Text>
        </Space>

        <Space>
          {isCurrentOrFuture && isManager && plans.length === 0 && (
            <Button type="primary" onClick={handleInitWeek} loading={initWeek.isPending}>
              {t('local_sell.init_week')}
            </Button>
          )}
          {isCurrentOrFuture && (
            <>
              {(statusCounts.draft > 0 || statusCounts.rejected > 0) && canEdit && (
                <Button onClick={handleBulkSubmit} loading={bulkSubmit.isPending}>
                  {t('local_sell.submit_all')} ({statusCounts.draft + statusCounts.rejected})
                </Button>
              )}
              {statusCounts.submitted > 0 && isManager && (
                <Button type="primary" onClick={handleBulkApprove} loading={bulkApprove.isPending}>
                  {t('local_sell.approve_all')} ({statusCounts.submitted})
                </Button>
              )}
            </>
          )}
        </Space>
      </Flex>

      {/* Summary */}
      {plans.length > 0 && (
        <Flex gap={24} style={{ marginBottom: 16 }}>
          <Statistic title={t('local_sell.total')} value={totalPlan} suffix="kg" />
          <Statistic title={t('local_sell.firms_count')} value={plans.length} />
        </Flex>
      )}

      {isError && <Alert type="error" message={t('local_sell.error_load')} style={{ marginBottom: 16 }} />}

      {isLoading ? (
        <Skeleton active />
      ) : (
        <Table<IWeeklyLocalSellPlan>
          dataSource={plans}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          bordered
          scroll={{ x: 1200 }}
          rowClassName={(row) => {
            if (row.status === 'submitted') return 'row-submitted';
            if (row.status === 'approved') return 'row-approved';
            if (row.status === 'rejected') return 'row-rejected';
            return '';
          }}
        />
      )}
    </div>
  );
}
