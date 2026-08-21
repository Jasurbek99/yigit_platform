import { useState, useMemo } from 'react';
import {
  Table,
  DatePicker,
  Tag,
  Skeleton,
  Alert,
  Flex,
  Typography,
  Button,
  Space,
  Card,
  Collapse,
  Statistic,
  Tooltip,
  Modal,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { toast } from 'sonner';
import {
  LeftOutlined,
  RightOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  UndoOutlined,
  BulbOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import {
  useHarvestPlans,
  useInitializeWeek,
  useDayEntries,
  useUpsertDayEntry,
  useBulkGrantLateEdit,
  useBulkRevokeLateEdit,
} from '@/hooks/usePlanning';
import { useGreenhouseConfig } from '@/hooks/useGreenhouseConfig';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useUiStore } from '@/stores/uiStore';
import api from '@/services/api';
import { HarvestCell } from '@/components/HarvestCell';
import { getCurrentForecastWindow, num, fmtKg } from '@/components/HarvestCell.helpers';
import { CellHistoryModal } from '@/components/CellHistoryModal';
import { GrantExtensionModal } from '@/components/GrantExtensionModal';
import type { IWeeklyHarvestPlan, IHarvestDayEntry } from '@/types';
import { TruckAllocationTable } from './TruckAllocationTable';
import { COLORS } from '@/constants/styles';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Title, Text } = Typography;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = (typeof DAYS)[number];

interface IGenerateTasksResponse {
  created: number;
}


export default function WeeklyPlanGrid() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Deep links (weekly-plan tasks, boss heatmap) carry ?week=&year=&block=.
  // `block` is a block_id from task links but a block_code from the heatmap, so
  // match either when highlighting the linked row.
  const deepLinkBlock = searchParams.get('block');

  const [selectedWeek, setSelectedWeek] = useState<Dayjs | null>(() => {
    // Honor a task/heatmap deep link's ISO week; Jan 4 is always in ISO week 1,
    // so adding (week-1) weeks lands on the target ISO week regardless of year.
    const wk = Number(searchParams.get('week'));
    const yr = Number(searchParams.get('year'));
    if (wk && yr) return dayjs(`${yr}-01-04`).add(wk - 1, 'week');
    // After Thursday (Fri/Sat/Sun) the current week's past/today cells are read-only
    // for managers, so default to next week to land on editable cells.
    return dayjs().isoWeekday() > 4 ? dayjs().add(1, 'week') : dayjs();
  });
  const transposed = useUiStore((s) => s.planPivotMode);
  const setTransposed = useUiStore((s) => s.setPlanPivotMode);
  const showSunday = useUiStore((s) => s.planShowSunday);
  const setShowSunday = useUiStore((s) => s.setPlanShowSunday);
  // Sunday is the last day in DAYS, so dropping it keeps every other day's
  // index (di) intact — used for date offsets and day_of_week throughout.
  const activeDays: Day[] = showSunday ? [...DAYS] : DAYS.slice(0, 6);
  const [historyEntry, setHistoryEntry] = useState<IHarvestDayEntry | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);

  const weekNumber = selectedWeek?.isoWeek();
  const year = selectedWeek?.isoWeekYear();

  // `activeSeason` (the TRUE active/write-target season, never the browsed
  // one) is kept ONLY for the initialize-week mutation and its availability
  // gate below — both create rows, which always target the active season
  // regardless of what's being browsed. It is deliberately NOT passed into
  // useHarvestPlans/useDayEntries: those are reads, and the hooks now own
  // season selection internally via the global store (useSelectedSeason()),
  // so the switcher (Task 15/16) actually has an effect on this page.
  const { data: seasonsData } = useSeasons();
  const activeSeason = seasonsData?.find((s) => s.is_active);
  // The season the grid's DATA actually belongs to (`useHarvestPlans` /
  // `useDayEntries` read via the global switcher) — used only for the header
  // label. Was `activeSeason.name` before Task 15; once a switcher exists
  // that shows the wrong season's name beside browsed-season figures.
  const { seasonId: browsedSeasonId } = useSelectedSeason();
  const browsedSeason = seasonsData?.find((s) => s.id === browsedSeasonId);
  const isReadOnly = useSeasonReadOnly();
  const { data: config } = useGreenhouseConfig();

  // ─── Week date range for day-entry queries ─────────────────────────────────

  const weekMonday = selectedWeek ? selectedWeek.isoWeekday(1) : dayjs().isoWeekday(1);
  const weekSunday = weekMonday.add(6, 'day');
  const dateFrom = weekMonday.format('YYYY-MM-DD');
  const dateTo = weekSunday.format('YYYY-MM-DD');

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const { data: plansData, isLoading: plansLoading, isError } = useHarvestPlans({ year, week: weekNumber });
  const { data: dayEntries = [], isLoading: entriesLoading } = useDayEntries({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const initWeek = useInitializeWeek();
  const upsertEntry = useUpsertDayEntry();
  const bulkGrant = useBulkGrantLateEdit();
  const bulkRevoke = useBulkRevokeLateEdit();

  const isLoading = plansLoading || entriesLoading;

  // ─── Derived data ──────────────────────────────────────────────────────────

  const queryClient = useQueryClient();

  const myBlockIds = useMemo(() => new Set(user?.managed_block_ids ?? []), [user?.managed_block_ids]);
  const isBlockManager = user?.role === 'greenhouse_manager' && myBlockIds.size > 0;
  // `isAdmin` stays admin+director on purpose — it feeds `canEditTrucks`, whose
  // backend gate is TRUCK_WRITE (admin/export_manager/director) and has no boss.
  // Widening it would show boss truck-editing UI that 403s.
  const isAdmin = user?.role === 'admin' || user?.role === 'director';
  // Operational admin authority — mirrors backend ADMIN_LIKE (admin + boss).
  // Drives the override-with-reason flow and the late-edit extension controls.
  const isAdminLike = user?.role === 'admin' || user?.role === 'boss';
  // Harvest grid + Initialize Week: admin, director (legacy) and boss.
  const canEditHarvest = isAdmin || isAdminLike;
  // Boss's cell shows ONE value — the plan. The admin cell carries a second,
  // the auto-computed actual, and writing that by hand is an *override*: it
  // makes `rollup_actuals` skip that block-day permanently. Boss is on this
  // page to enter plans, so the actual is removed from his cell rather than
  // left one click away. admin/director keep both — overriding a bad rollup
  // value is genuinely their job.
  const planOnlyCells = user?.role === 'boss';
  const isManager = canEditHarvest;
  // Truck allocation is editable by the export_manager too (backend TRUCK_WRITE
  // grants it write access), unlike the harvest grid / Initialize Week which stay
  // admin+director only. `useSetTruckDestinationSelection`/`useUpsertTruckAllocation`/
  // `useSetTruckSplits` all write to the TRUE active season regardless of what's
  // browsed (mirrors Initialize Week), so a click here can't 409 either — gated
  // on `isReadOnly` anyway so editing doesn't appear live over a closed season's
  // read-only grid.
  const canEditTrucks = (isAdmin || user?.role === 'export_manager') && !isReadOnly;
  // Generate plan tasks is a supervisor action: admin, export_manager, director, boss.
  const canGenerateTasks =
    user?.role === 'admin' ||
    user?.role === 'export_manager' ||
    user?.role === 'director' ||
    user?.role === 'boss';

  const generateTasksMutation = useMutation<
    IGenerateTasksResponse,
    unknown,
    { year: number; week: number }
  >({
    mutationFn: async ({ year: y, week: w }) => {
      const { data } = await api.post<IGenerateTasksResponse>(
        '/export/tasks/generate-weekly-plan/',
        { year: y, week: w },
      );
      return data;
    },
    onSuccess: (data) => {
      toast.success(t('plan.generate_tasks_toast', { count: data.created }));
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
    onError: () => {
      toast.error(t('common.error'));
    },
  });

  const plans: IWeeklyHarvestPlan[] = useMemo(() => {
    const raw = plansData?.results ?? [];
    if (!isBlockManager) return raw;
    const mine = raw.filter((p) => myBlockIds.has(p.block));
    const rest = raw.filter((p) => !myBlockIds.has(p.block));
    return [...mine, ...rest];
  }, [plansData, isBlockManager, myBlockIds]);

  /** Map keyed by `${blockId}-${YYYY-MM-DD}` → IHarvestDayEntry */
  const entriesByBlockDay = useMemo((): Map<string, IHarvestDayEntry> => {
    const map = new Map<string, IHarvestDayEntry>();
    for (const e of dayEntries) {
      map.set(`${e.block}-${e.entry_date}`, e);
    }
    return map;
  }, [dayEntries]);

  // Fallback mode button visibility
  const isInFallbackWindow: boolean = useMemo(() => {
    if (!config) return false;
    const now = dayjs();
    const tomorrow = now.startOf('day').add(1, 'day');
    const win = getCurrentForecastWindow(now, tomorrow, config);
    return win === 'fallback';
  }, [config]);

  // loading_dept_head replaced warehouse_chief on this surface in May 2026.
  // Admin keeps access for ops support. The fallback-mode UI itself is now
  // a subset of loading_dept_head's broader window and may be retired later.
  const canSeeFallbackMode =
    user?.role === 'loading_dept_head' || user?.role === 'loading_dept_head_deputy' || user?.role === 'admin';

  // ─── KPI totals from day entries ───────────────────────────────────────────

  const { totalPlan, totalActual, dayPlanTotals, lateCount, criticalLateCount } = useMemo(() => {
    let plan = 0, actual = 0, late = 0, critical = 0;
    const dayTotalsMap: Record<string, number> = {};
    for (const e of dayEntries) {
      const v = num(e.plan_value);
      plan += v;
      actual += e.actual_value != null ? num(e.actual_value) : 0;
      dayTotalsMap[e.entry_date] = (dayTotalsMap[e.entry_date] ?? 0) + v;
      if (e.plan_state === 'late') late += 1;
      else if (e.plan_state === 'critical_late') critical += 1;
    }
    return {
      totalPlan: plan,
      totalActual: actual,
      dayPlanTotals: dayTotalsMap,
      lateCount: late,
      criticalLateCount: critical,
    };
  }, [dayEntries]);

  const truckCapacity = config ? Number(config.truck_capacity_kg) : 18500;
  const estTrucks = totalPlan > 0 ? (totalPlan / truckCapacity).toFixed(1) : '0';

  /** Plans that currently have an active late-edit extension */
  const activeExtensionPlans = useMemo(
    () => plans.filter((p) => p.late_edit_active),
    [plans],
  );

  /** IDs of all currently-displayed plans (for bulk grant) */
  const allPlanIds = useMemo(() => plans.map((p) => p.id), [plans]);

  /** IDs of plans with an active extension (for bulk revoke) */
  const activeExtensionIds = useMemo(
    () => activeExtensionPlans.map((p) => p.id),
    [activeExtensionPlans],
  );

  // ─── Permission helpers ────────────────────────────────────────────────────

  function hasBlockPermission(blockId: number): boolean {
    if (!user) return false;
    if (canEditHarvest) return true;
    if (user.role === 'greenhouse_manager') return user.managed_block_ids.includes(blockId);
    return false;
  }

  function canEditPlanForEntry(entry: IHarvestDayEntry): boolean {
    if (isReadOnly) return false;
    if (!hasBlockPermission(entry.block)) return false;
    // Both admin and greenhouse_manager can edit any plan cell at any time.
    // Lateness is tracked via entry.plan_state and surfaces as a cell badge;
    // late/critical_late submissions notify admin + director.
    return true;
  }

  function canEditActualForEntry(entry: IHarvestDayEntry): boolean {
    if (isReadOnly) return false;
    // Actuals are computed daily by the rollup_actuals job from shipment loading
    // data. Only admin can override a computed value. _entry parameter retained
    // for symmetry with the other can-edit helpers and future block-level rules.
    void entry;
    // Not `isAdminLike`: boss's cell is planOnly, so granting him actual-edit
    // would leave the capability live with no UI path to reach it deliberately.
    return isAdminLike && !planOnlyCells;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleCellSave(
    entryId: number,
    field: 'plan_value' | 'actual_value',
    value: number | null,
    reason?: string,
  ) {
    const key = String(entryId);
    setSavingKey(key);
    upsertEntry.mutate(
      { id: entryId, [field]: value, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          toast.success(
            t(field === 'plan_value' ? 'plan.toast_plan_saved' : 'plan.toast_actual_saved'),
          );
          setSavingKey(null);
        },
        onError: (err: unknown) => {
          const apiErr = err as { response?: { data?: { error?: string } } };
          const serverMsg = apiErr?.response?.data?.error ?? '';
          if (serverMsg.includes('Plan edits')) {
            toast.error(t('plan.edit_window_closed_toast'));
          } else {
            toast.error(t('plan.toast_save_error'));
          }
          setSavingKey(null);
        },
      },
    );
  }

  function handleGenerateTasks() {
    if (!weekNumber || !year) return;
    generateTasksMutation.mutate({ year, week: weekNumber });
  }

  function handleInitializeWeek() {
    if (!activeSeason || !weekNumber || !year) return;
    initWeek.mutate(
      { season: activeSeason.id, week_number: weekNumber, year },
      { onSuccess: () => toast.success(t('plan.toast_initialized')) },
    );
  }

  function handleBulkGrant(granted_until: string) {
    bulkGrant.mutate(
      { plan_ids: allPlanIds, granted_until },
      {
        onSuccess: (data) => {
          toast.success(t('plan.bulk_grant_toast', { count: data.updated }));
          setExtensionModalOpen(false);
        },
        onError: (err: unknown) => {
          const apiErr = err as { response?: { data?: { error?: string; granted_until?: string[] } } };
          const msg =
            apiErr?.response?.data?.granted_until?.[0] ??
            apiErr?.response?.data?.error ??
            t('common.error');
          toast.error(msg);
        },
      },
    );
  }

  function handleBulkRevoke() {
    Modal.confirm({
      title: t('plan.bulk_revoke_confirm_title'),
      content: t('plan.bulk_revoke_confirm_content'),
      okType: 'danger',
      okText: t('plan.bulk_revoke_button'),
      cancelText: t('common.cancel'),
      onOk() {
        bulkRevoke.mutate(
          { plan_ids: activeExtensionIds },
          {
            onSuccess: (data) => toast.success(t('plan.bulk_revoke_toast', { count: data.updated })),
            onError: () => toast.error(t('common.error')),
          },
        );
      },
    });
  }

  // ─── Column definitions (normal view: blocks as rows) ─────────────────────

  const dayColumns = activeDays.map((day, di) => {
    const colDate = weekMonday.add(di, 'day');
    const colDateStr = colDate.format('YYYY-MM-DD');
    return {
      title: (
        <div style={{ textAlign: 'center', lineHeight: '16px' }}>
          <div>{t(`plan.${day}`)}</div>
          <div style={{ fontSize: 10, color: COLORS.textSecondary, fontWeight: 400 }}>
            {colDate.format('DD.MM')}
          </div>
        </div>
      ),
      key: `${day}_cell`,
      width: 120,
      render: (_: unknown, row: IWeeklyHarvestPlan) => {
        const entry = entriesByBlockDay.get(`${row.block}-${colDateStr}`);
        if (!entry) return <span style={{ color: COLORS.textMuted }}>—</span>;
        return (
          <HarvestCell
            entry={entry}
            canEditPlan={canEditPlanForEntry(entry)}
            canEditActual={canEditActualForEntry(entry)}
            onSave={handleCellSave}
            onCellClick={(id) => {
              const found = dayEntries.find((e) => e.id === id);
              if (found) setHistoryEntry(found);
            }}
            isAdmin={isAdminLike}
            planOnly={planOnlyCells}
            savingKey={savingKey}
          />
        );
      },
    };
  });

  const columns: TableColumnsType<IWeeklyHarvestPlan> = [
    {
      title: t('plan.block'),
      key: 'block',
      fixed: 'left',
      width: 160,
      render: (_: unknown, row: IWeeklyHarvestPlan) => {
        const isLinked =
          !!deepLinkBlock &&
          (String(row.block) === deepLinkBlock || row.block_code === deepLinkBlock);
        return (
        <div
          style={
            isLinked
              ? { background: COLORS.bgLight, borderLeft: `3px solid ${COLORS.primary}`, paddingLeft: 6, margin: '-2px 0' }
              : undefined
          }
        >
          <Tag color={isBlockManager && myBlockIds.has(row.block) ? 'gold' : 'blue'}>
            {row.block_code}
          </Tag>
          {row.late_edit_active && (
            <Tag color="orange" style={{ marginLeft: 2, fontSize: 10 }}>
              <ClockCircleOutlined />
            </Tag>
          )}
          <div style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 2 }}>{row.block_name}</div>
          {row.block_manager_names.length > 0 && (
            <div style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 1 }}>
              <UserOutlined style={{ marginRight: 3 }} />
              {row.block_manager_names.join(', ')}
            </div>
          )}
        </div>
        );
      },
    },
    ...dayColumns,
  ];

  // ─── Transposed view (days as rows, blocks as columns) ────────────────────

  interface ITransposedRow {
    key: string;
    day: Day;
    dayLabel: string;
    dateStr: string;
  }

  const transposedData: ITransposedRow[] = activeDays.map((day, di) => {
    const colDate = weekMonday.add(di, 'day');
    return {
      key: day,
      day,
      dayLabel: `${t(`plan.${day}`)} ${colDate.format('DD.MM')}`,
      dateStr: colDate.format('YYYY-MM-DD'),
    };
  });

  const transposedColumns: TableColumnsType<ITransposedRow> = [
    {
      title: '',
      dataIndex: 'dayLabel',
      key: 'day',
      fixed: 'left',
      width: 100,
      render: (text: string) => <strong>{text}</strong>,
    },
    ...plans.map((p) => {
      const isMine = isBlockManager && myBlockIds.has(p.block);
      return {
        title: (
          <div style={{ textAlign: 'center' as const }}>
            <Tag color={isMine ? 'gold' : 'blue'}>{p.block_code}</Tag>
            {p.block_manager_names.length > 0 && (
              <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 400, marginTop: 1 }}>
                {p.block_manager_names.join(', ')}
              </div>
            )}
          </div>
        ),
        key: p.block_code,
        width: 130,
        onCell: () => ({ style: isMine ? { backgroundColor: COLORS.bgYellow } : undefined }),
        onHeaderCell: () => ({ style: isMine ? { backgroundColor: COLORS.bgYellow } : undefined }),
        render: (_: unknown, row: ITransposedRow) => {
          const entry = entriesByBlockDay.get(`${p.block}-${row.dateStr}`);
          if (!entry) return <span style={{ color: COLORS.textMuted }}>—</span>;
          return (
            <HarvestCell
              entry={entry}
              canEditPlan={canEditPlanForEntry(entry)}
              canEditActual={canEditActualForEntry(entry)}
              onSave={handleCellSave}
              onCellClick={(id) => {
                const found = dayEntries.find((e) => e.id === id);
                if (found) setHistoryEntry(found);
              }}
              isAdmin={isAdminLike}
              planOnly={planOnlyCells}
              savingKey={savingKey}
            />
          );
        },
      };
    }),
  ];

  // ─── Summary row helpers ───────────────────────────────────────────────────

  function renderSummary() {
    return (
      <Table.Summary.Row style={{ fontWeight: 600 }}>
        <Table.Summary.Cell index={0}>{t('plan.total')}</Table.Summary.Cell>
        {activeDays.map((day, di) => {
          const colDate = weekMonday.add(di, 'day');
          const colDateStr = colDate.format('YYYY-MM-DD');
          const planTotal = plans.reduce((s, p) => {
            const e = entriesByBlockDay.get(`${p.block}-${colDateStr}`);
            return s + num(e?.plan_value);
          }, 0);
          const actualTotal = plans.reduce((s, p) => {
            const e = entriesByBlockDay.get(`${p.block}-${colDateStr}`);
            return s + num(e?.actual_value);
          }, 0);
          return (
            <Table.Summary.Cell key={`sum_${day}`} index={1 + di}>
              <div>
                <div style={{ color: COLORS.primary, fontSize: 12 }}>{fmtKg(planTotal || null)}</div>
                {actualTotal > 0 && (
                  <div style={{ color: COLORS.success, fontSize: 12 }}>{fmtKg(actualTotal)}</div>
                )}
              </div>
            </Table.Summary.Cell>
          );
        })}
      </Table.Summary.Row>
    );
  }

  function renderTransposedSummary() {
    return (
      <>
        <Table.Summary.Row style={{ fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>
            <span style={{ color: COLORS.primary }}>{t('plan.total')} {t('plan.plan')}</span>
          </Table.Summary.Cell>
          {plans.map((p, i) => {
            const blockTotal = activeDays.reduce((s, _, di) => {
              const colDate = weekMonday.add(di, 'day');
              const e = entriesByBlockDay.get(`${p.block}-${colDate.format('YYYY-MM-DD')}`);
              return s + num(e?.plan_value);
            }, 0);
            return (
              <Table.Summary.Cell key={`tp_${p.id}`} index={1 + i}>
                <span style={{ color: COLORS.primary }}>{fmtKg(blockTotal || null)}</span>
              </Table.Summary.Cell>
            );
          })}
        </Table.Summary.Row>
        <Table.Summary.Row style={{ fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>
            <span style={{ color: COLORS.success }}>{t('plan.total')} {t('plan.actual')}</span>
          </Table.Summary.Cell>
          {plans.map((p, i) => {
            const blockTotal = activeDays.reduce((s, _, di) => {
              const colDate = weekMonday.add(di, 'day');
              const e = entriesByBlockDay.get(`${p.block}-${colDate.format('YYYY-MM-DD')}`);
              return s + num(e?.actual_value);
            }, 0);
            return (
              <Table.Summary.Cell key={`ta_${p.id}`} index={1 + i}>
                <span style={{ color: COLORS.success }}>{fmtKg(blockTotal || null)}</span>
              </Table.Summary.Cell>
            );
          })}
        </Table.Summary.Row>
      </>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  // Show Initialize Week when plans are missing OR plans exist but day-entry cells
  // were never created (legacy data created before initialize_harvest_week backfilled
  // HarvestDayEntry rows). The endpoint is idempotent.
  const expectedDayEntries = plans.length * DAYS.length;
  const showInitialize =
    !isLoading &&
    !!isManager &&
    !!activeSeason &&
    (plans.length === 0 || dayEntries.length < expectedDayEntries);

  return (
    <div>
      <Flex justify="space-between" align="flex-start" wrap gap={12} style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('plan.title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('plan.week')} {weekNumber} · {year} · {plans.length} {t('plan.blocks')}
            {browsedSeason && <span> · {browsedSeason.name}</span>}
          </Text>
        </div>
        <Space wrap>
          <Button
            icon={<LeftOutlined />}
            onClick={() => setSelectedWeek((w) => (w ?? dayjs()).subtract(1, 'week'))}
            aria-label={t('plan.prev_week')}
          />
          <DatePicker
            picker="week"
            value={selectedWeek}
            onChange={(d) => setSelectedWeek(d)}
            allowClear={false}
            style={{ width: 180 }}
          />
          <Button
            icon={<RightOutlined />}
            onClick={() => setSelectedWeek((w) => (w ?? dayjs()).add(1, 'week'))}
            aria-label={t('plan.next_week')}
          />
          {plans.length > 0 && (
            <Button
              icon={<SwapOutlined />}
              onClick={() => setTransposed(!transposed)}
              type={transposed ? 'primary' : 'default'}
            >
              {t('plan.pivot')}
            </Button>
          )}
          {plans.length > 0 && (
            <Button
              icon={<CalendarOutlined />}
              onClick={() => setShowSunday(!showSunday)}
              type={showSunday ? 'primary' : 'default'}
            >
              {showSunday ? t('plan.hide_sunday') : t('plan.show_sunday')}
            </Button>
          )}
          {isAdminLike && plans.length > 0 && (
            <Button
              icon={<ClockCircleOutlined />}
              size="small"
              disabled={isReadOnly}
              onClick={() => setExtensionModalOpen(true)}
            >
              {t('plan.bulk_grant_button')}
            </Button>
          )}
          {isAdminLike && activeExtensionIds.length > 0 && (
            <Button
              danger
              size="small"
              icon={<UndoOutlined />}
              loading={bulkRevoke.isPending}
              disabled={isReadOnly}
              onClick={handleBulkRevoke}
            >
              {t('plan.bulk_revoke_button')}
            </Button>
          )}
          {canGenerateTasks && (
            <Button
              icon={<BulbOutlined />}
              loading={generateTasksMutation.isPending}
              onClick={handleGenerateTasks}
              disabled={!weekNumber || !year || isReadOnly}
            >
              {t('plan.generate_tasks')}
            </Button>
          )}
          {showInitialize && (
            <Button
              type="primary"
              loading={initWeek.isPending}
              // Initialize Week always creates rows in the TRUE active season
              // (see the `activeSeason` comment above), never the browsed one,
              // so a click here can't 409. Disabled anyway while browsing a
              // closed season: the button reacts to the BROWSED season's empty
              // grid (plans.length === 0), so leaving it live would let someone
              // "initialize" what looks like the season they're looking at
              // while it silently writes into a different one.
              disabled={isReadOnly}
              onClick={handleInitializeWeek}
            >
              {t('plan.initialize_week')}
            </Button>
          )}
          {canSeeFallbackMode && isInFallbackWindow && (
            <Button
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => navigate('/greenhouse/fallback-forecast')}
            >
              {t('plan.fallback_mode')}
            </Button>
          )}
        </Space>
      </Flex>

      {/* KPI stat cards */}
      {plans.length > 0 && (
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t('plan.total_plan')}
              value={totalPlan}
              suffix="kg"
              styles={{ content: { color: COLORS.primary, fontSize: 20 } }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t('plan.total_actual')}
              value={totalActual}
              suffix="kg"
              styles={{ content: { color: COLORS.success, fontSize: 20 } }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t('plan.est_trucks')}
              value={estTrucks}
              styles={{ content: { color: COLORS.purple, fontSize: 20 } }}
              suffix={t('plan.trucks_suffix')}
            />
          </Card>
          {(lateCount > 0 || criticalLateCount > 0) && (
            <Card size="small" style={{ flex: 1, minWidth: 150 }}>
              <Tooltip
                title={t('plan.late_submissions_tooltip', { late: lateCount, critical: criticalLateCount })}
              >
                <Statistic
                  title={t('plan.late_submissions')}
                  value={lateCount + criticalLateCount}
                  styles={{ content: { color: criticalLateCount > 0 ? COLORS.danger : COLORS.warning, fontSize: 20 } }}
                />
              </Tooltip>
            </Card>
          )}
        </Flex>
      )}

      {/* Late-edit extension banners (visible to all roles) */}
      {activeExtensionPlans.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            activeExtensionPlans.length <= 2 ? (
              <Flex vertical gap={4}>
                {activeExtensionPlans.map((p) => (
                  <div key={p.id}>
                    <strong>{p.block_code}</strong>{' '}
                    {t('plan.extension_active', {
                      until: dayjs(p.late_edit_granted_until!).format('DD.MM.YYYY HH:mm'),
                      by: p.late_edit_granted_by_name ?? '—',
                    })}
                    {p.late_edit_granted_reason && (
                      <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>
                        {t('plan.extension_reason', { reason: p.late_edit_granted_reason })}
                      </div>
                    )}
                  </div>
                ))}
              </Flex>
            ) : (
              <details>
                <summary>
                  {t('plan.extensions_active_count', { count: activeExtensionPlans.length })}
                </summary>
                <Flex vertical gap={4} style={{ marginTop: 4 }}>
                  {activeExtensionPlans.map((p) => (
                    <div key={p.id}>
                      <strong>{p.block_code}</strong>{' '}
                      {t('plan.extension_active', {
                        until: dayjs(p.late_edit_granted_until!).format('DD.MM.YYYY HH:mm'),
                        by: p.late_edit_granted_by_name ?? '—',
                      })}
                      {p.late_edit_granted_reason && (
                        <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>
                          {t('plan.extension_reason', { reason: p.late_edit_granted_reason })}
                        </div>
                      )}
                    </div>
                  ))}
                </Flex>
              </details>
            )
          }
        />
      )}

      {isError && (
        <Alert type="error" message={t('plan.error_load')} style={{ marginBottom: 16 }} />
      )}

      {isLoading ? (
        <Skeleton active />
      ) : plans.length === 0 && !showInitialize ? (
        <Alert type="info" message={t('plan.empty_week')} style={{ marginBottom: 16 }} />
      ) : transposed ? (
        <Table<ITransposedRow>
          columns={transposedColumns}
          dataSource={transposedData}
          rowKey="key"
          bordered
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={renderTransposedSummary}
        />
      ) : (
        <Table<IWeeklyHarvestPlan>
          columns={columns}
          dataSource={plans}
          rowKey="id"
          bordered
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={renderSummary}
          onRow={(row) => ({
            style: {
              backgroundColor:
                isBlockManager && myBlockIds.has(row.block) ? COLORS.bgYellow : undefined,
              boxShadow:
                isBlockManager && myBlockIds.has(row.block)
                  ? 'inset 3px 0 0 #faad14'
                  : undefined,
            },
          })}
        />
      )}

      {/* Truck allocation section */}
      {plans.length > 0 && (
        <Collapse
          defaultActiveKey={['trucks']}
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'trucks',
              label: <strong>{t('plan.truck_allocation')}</strong>,
              children: (
                <TruckAllocationTable
                  plans={plans}
                  weekNumber={weekNumber}
                  year={year}
                  seasonId={activeSeason?.id}
                  isManager={canEditTrucks}
                  weekMonday={weekMonday}
                  totalPlanKg={totalPlan}
                  dayTotals={dayPlanTotals}
                  showSunday={showSunday}
                />
              ),
            },
          ]}
        />
      )}

      {/* Cell history modal */}
      <CellHistoryModal
        entry={historyEntry}
        onClose={() => setHistoryEntry(null)}
      />

      {/* Late-edit extension modal (admin only) */}
      <GrantExtensionModal
        open={extensionModalOpen}
        isSubmitting={bulkGrant.isPending}
        onConfirm={handleBulkGrant}
        onClose={() => setExtensionModalOpen(false)}
      />
    </div>
  );
}
