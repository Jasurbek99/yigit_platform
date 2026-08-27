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
import { isAxiosError } from 'axios';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import {
  useLocalSellPlans,
  useUpsertLocalSellPlan,
  useInitializeLocalSellWeek,
  useBulkApproveLocalSellPlans,
} from '@/hooks/usePlanning';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import { canDoBackendGated } from '@/utils/permissions';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import type { IWeeklyLocalSellPlan, PlanStatus } from '@/types';
import { cellMode, lockReasonKey, saveErrorKey } from './LocalSellPlanGrid.cells';
import type { CellMode } from './LocalSellPlanGrid.cells';

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

interface IWeekInOtherSeason { error: string; season: string | null; count: number }

function isWeekInOtherSeason(data: unknown): data is IWeekInOtherSeason {
  return typeof data === 'object' && data !== null && 'error' in data
    && (data as { error: unknown }).error === 'week_exists_in_other_season';
}

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

/**
 * One day cell. `mode` comes from `cellMode()` — see LocalSellPlanGrid.cells.ts
 * for the rule and why it must stay identical to the backend's.
 *
 * There is no Send button: blur saves, and the first non-zero save sends the
 * whole week for approval. Which is exactly why a locked cell has to say WHO
 * can change it — `reasonKey` carries that sentence.
 */
function PlanCell({ day, row, mode, reasonKey, onSave }: {
  day: Day; row: IWeeklyLocalSellPlan; mode: CellMode; reasonKey: string;
  onSave: (row: IWeeklyLocalSellPlan, day: Day, value: number) => void;
}) {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState(false);
  const field = `${day}_plan_kg` as keyof IWeeklyLocalSellPlan;
  const value = num(row[field]);

  if (mode === 'edit' || (mode === 'unlockable' && unlocked)) {
    return (
      <InputNumber
        min={0} step={100} keyboard={false}
        // `|| undefined`, not the raw 0: the column is NOT NULL default 0, so 0
        // is how the DB spells "never filled in". Showing it as a blank cell
        // with a placeholder is what makes the fill-empties rule legible —
        // otherwise every untouched day reads as a deliberate zero.
        defaultValue={value || undefined}
        placeholder="—"
        onBlur={(e) => {
          const v = Number(e.target.value.replace(/,/g, '')) || 0;
          if (v !== value) onSave(row, day, v);
          if (mode === 'unlockable') setUnlocked(false);
        }}
        onKeyDown={handleCellKeyDown}
        size="small" style={{ width: 84 }}
        autoFocus={mode === 'unlockable' && unlocked}
      />
    );
  }

  // Sent for approval, value already entered, and the viewer may override it.
  if (mode === 'unlockable') {
    return (
      <Tooltip title={t('local_sell.double_click_hint')}>
        <span onDoubleClick={() => setUnlocked(true)} style={{ cursor: 'pointer' }}>
          {fmtKg(value)}
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={t(reasonKey)}>
      <Text type="secondary" style={{ cursor: 'not-allowed' }}>{fmtKg(value)}</Text>
    </Tooltip>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function LocalSellPlanGrid() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const role = user?.role;
  // A closed season beats every role — same rule the Sheet, the Weekly Plan
  // grid and the shipment screens apply. It matters more here since
  // initialize-week started targeting the BROWSED season (below): without this
  // the button would render enabled on a closed season and 409 on click.
  const isSeasonReadOnly = useSeasonReadOnly();
  // canDoBackendGated, not canDo: views_planning.py gates create/update on
  // LOCAL_SELL_WRITE (core/roles.py), which excludes boss whatever the
  // permission matrix says.
  const canEdit = !isSeasonReadOnly && canDoBackendGated(user, 'local_sell_plan', 'edit');
  const isManager = !isSeasonReadOnly
    && (role === 'admin' || role === 'export_manager' || role === 'director');

  // Deep-link from a task card: ?week=&year= opens that ISO week (else current).
  const [searchParams] = useSearchParams();
  const [selectedWeek, setSelectedWeek] = useState<Dayjs | null>(() => {
    const weekParam = Number(searchParams.get('week'));
    const yearParam = Number(searchParams.get('year'));
    if (weekParam >= 1 && weekParam <= 53 && yearParam > 2000) {
      // ISO week 1 always contains Jan 4; add (week-1) weeks from its Monday.
      const week1Monday = dayjs().year(yearParam).month(0).date(4).startOf('isoWeek');
      return week1Monday.add(weekParam - 1, 'week');
    }
    return dayjs();
  });

  const weekNumber = selectedWeek?.isoWeek();
  const year = selectedWeek?.isoWeekYear();

  // The BROWSED season, not the active one. `useLocalSellPlans` below lists by
  // exactly this id, so initializing into `useSeasons().find(is_active)` (what
  // this did) seeded rows the grid then refused to show whenever the header
  // switcher pointed elsewhere. It also drops a `useSeasons()` call the seller
  // has no `season.can_view` for — that request 403s for them.
  const { seasonId } = useSelectedSeason();

  const { data, isLoading, isError } = useLocalSellPlans({ year, week: weekNumber });
  const upsert = useUpsertLocalSellPlan();
  const initWeek = useInitializeLocalSellWeek();
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
    const wasOpen = row.status === 'draft' || row.status === 'rejected';
    upsert.mutate({ id: row.id, [`${day}_plan_kg`]: value }, {
      // No toast on a plain save — the value staying on screen is the receipt.
      // The one thing worth announcing is the side effect nobody clicked: the
      // backend auto-submits the week on the first non-zero save.
      onSuccess: (saved) => {
        if (wasOpen && saved.status === 'submitted') {
          toast.success(t('local_sell.auto_submitted'));
        }
      },
      // Three different guards answer 409 here (approved lock, per-cell lock,
      // closed season) and each names a different person to go and ask.
      onError: (err) => {
        const body = isAxiosError(err) ? err.response?.data : undefined;
        toast.error(t(saveErrorKey(body)));
      },
    });
  }

  function handleInitWeek() {
    if (!weekNumber || !year) return;
    initWeek.mutate(
      { week_number: weekNumber, year, season: seasonId ?? undefined },
      {
        onSuccess: (d) => toast.success(t('local_sell.init_success', { count: d.count })),
        // The one error worth naming: the table is UNIQUE (firm, week, year)
        // with no season in the key, so a week already entered under another
        // season cannot be re-created under this one. Without this the request
        // failed silently and the grid just stayed empty.
        onError: (err) => {
          const data = isAxiosError(err) ? err.response?.data : undefined;
          if (isWeekInOtherSeason(data)) {
            toast.error(t('local_sell.init_other_season', { season: data.season ?? '?' }));
            return;
          }
          toast.error(t('local_sell.init_error'));
        },
      },
    );
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
          const cell = {
            status: row.status,
            value: num(row[`${day}_plan_kg` as keyof IWeeklyLocalSellPlan]),
            canEdit,
            isApprover: isManager,
          };
          return (
            <PlanCell
              day={day} row={row}
              mode={cellMode(cell)} reasonKey={lockReasonKey(cell)}
              onSave={handleSave}
            />
          );
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
          {/* canEdit, not isManager (2026-08-23, owner request): the seller owns
              the sell plan and opens their own week. The backend's
              initialize-week gate moved to LOCAL_SELL_WRITE to match. */}
          {isCurrentOrFuture && canEdit && plans.length === 0 && (
            <Button type="primary" onClick={handleInitWeek} loading={initWeek.isPending}>
              {t('local_sell.init_week')}
            </Button>
          )}
          {/* No Submit All (2026-08-23, owner request): cells autosave and the
              first non-zero save sends the week. Approve All stays — approving
              is still a deliberate act, and still APPROVE-only. */}
          {isCurrentOrFuture && statusCounts.submitted > 0 && isManager && (
            <Button type="primary" onClick={handleBulkApprove} loading={bulkApprove.isPending}>
              {t('local_sell.approve_all')} ({statusCounts.submitted})
            </Button>
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

      {/* The send button is gone, so the rule has to be written down somewhere. */}
      {canEdit && plans.length > 0 && (
        <Alert type="info" showIcon message={t('local_sell.autosave_hint')} style={{ marginBottom: 16 }} />
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
