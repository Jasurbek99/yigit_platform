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
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import {
  useHarvestPlans,
  useSubmitHarvestPlan,
  useInitializeWeek,
  useDayEntries,
  useUpsertDayEntry,
} from '@/hooks/usePlanning';
import { useGreenhouseConfig } from '@/hooks/useGreenhouseConfig';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import { getCurrentForecastWindow, HarvestCell, num, fmtKg } from '@/components/HarvestCell';
import { CellHistoryModal } from '@/components/CellHistoryModal';
import type { IWeeklyHarvestPlan, IHarvestDayEntry } from '@/types';
import { TruckAllocationTable } from './TruckAllocationTable';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Title, Text } = Typography;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type Day = (typeof DAYS)[number];


export default function WeeklyPlanGrid() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [selectedWeek, setSelectedWeek] = useState<Dayjs | null>(dayjs());
  const transposed = useUiStore((s) => s.planPivotMode);
  const setTransposed = useUiStore((s) => s.setPlanPivotMode);
  const [historyEntry, setHistoryEntry] = useState<IHarvestDayEntry | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const weekNumber = selectedWeek?.isoWeek();
  const year = selectedWeek?.isoWeekYear();

  const { data: seasonsData } = useSeasons();
  const activeSeason = seasonsData?.find((s) => s.is_active);
  const { data: config } = useGreenhouseConfig();

  // ─── Week date range for day-entry queries ─────────────────────────────────

  const weekMonday = selectedWeek ? selectedWeek.isoWeekday(1) : dayjs().isoWeekday(1);
  const weekSaturday = weekMonday.add(5, 'day');
  const dateFrom = weekMonday.format('YYYY-MM-DD');
  const dateTo = weekSaturday.format('YYYY-MM-DD');

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const { data: plansData, isLoading: plansLoading, isError } = useHarvestPlans({ year, week: weekNumber });
  const { data: dayEntries = [], isLoading: entriesLoading } = useDayEntries({
    season: activeSeason?.id,
    date_from: dateFrom,
    date_to: dateTo,
  });

  const submitPlan = useSubmitHarvestPlan();
  const initWeek = useInitializeWeek();
  const upsertEntry = useUpsertDayEntry();

  const isLoading = plansLoading || entriesLoading;

  // ─── Derived data ──────────────────────────────────────────────────────────

  const myBlockIds = new Set(user?.managed_block_ids ?? []);
  const isBlockManager = user?.role === 'greenhouse_manager' && myBlockIds.size > 0;
  const isAdmin = user?.role === 'admin' || user?.role === 'director';
  const isManager = isAdmin || user?.role === 'export_manager';

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

  const currentIsoWeek = dayjs().isoWeek();
  const currentIsoYear = dayjs().isoWeekYear();
  const isCurrentOrFutureWeek =
    (year ?? 0) > currentIsoYear ||
    ((year ?? 0) === currentIsoYear && (weekNumber ?? 0) >= currentIsoWeek);

  // Fallback mode button visibility
  const isInFallbackWindow: boolean = useMemo(() => {
    if (!config) return false;
    const now = dayjs();
    const tomorrow = now.startOf('day').add(1, 'day');
    const win = getCurrentForecastWindow(now, tomorrow, config);
    return win === 'fallback';
  }, [config]);

  const canSeeFallbackMode = user?.role === 'warehouse_chief' || user?.role === 'admin';

  // ─── KPI totals from day entries ───────────────────────────────────────────

  const { totalPlan, totalForecast, totalActual, dayPlanTotals } = useMemo(() => {
    let plan = 0, forecast = 0, actual = 0;
    const dayTotalsMap: Record<string, number> = {};
    for (const e of dayEntries) {
      const v = num(e.plan_value);
      plan += v;
      forecast += e.forecast_value != null ? num(e.forecast_value) : 0;
      actual += e.actual_value != null ? num(e.actual_value) : 0;
      dayTotalsMap[e.entry_date] = (dayTotalsMap[e.entry_date] ?? 0) + v;
    }
    return { totalPlan: plan, totalForecast: forecast, totalActual: actual, dayPlanTotals: dayTotalsMap };
  }, [dayEntries]);

  const truckCapacity = config ? Number(config.truck_capacity_kg) : 18500;
  const estTrucks = totalPlan > 0 ? (totalPlan / truckCapacity).toFixed(1) : '0';

  // ─── Permission helpers ────────────────────────────────────────────────────

  function hasBlockPermission(blockId: number): boolean {
    if (!user) return false;
    if (isAdmin || user.role === 'export_manager') return true;
    if (user.role === 'greenhouse_manager') return user.managed_block_ids.includes(blockId);
    return false;
  }

  function canEditPlanForEntry(entry: IHarvestDayEntry): boolean {
    // Plan editable for future days only; locked once forecast is submitted
    if (!hasBlockPermission(entry.block)) return false;
    const entryDate = dayjs(entry.entry_date);
    const today = dayjs().startOf('day');
    return entryDate.isAfter(today, 'day') && !entry.forecast_submitted_at;
  }

  function canEditForecastForEntry(entry: IHarvestDayEntry): boolean {
    if (!hasBlockPermission(entry.block)) return false;
    // warehouse_chief or admin can enter forecast in the forecast window
    if (user?.role !== 'warehouse_chief' && !isAdmin) return false;
    if (!config) return false;
    const now = dayjs();
    const entryDate = dayjs(entry.entry_date);
    const win = getCurrentForecastWindow(now, entryDate, config);
    return win !== null;
  }

  function canEditActualForEntry(entry: IHarvestDayEntry): boolean {
    if (!hasBlockPermission(entry.block)) return false;
    // Actuals editable on same day and past days (only if not finalized)
    const entryDate = dayjs(entry.entry_date);
    const today = dayjs().startOf('day');
    if (entryDate.isAfter(today, 'day')) return false;
    return !entry.actual_finalized_at;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleCellSave(
    entryId: number,
    field: 'plan_value' | 'forecast_value' | 'actual_value',
    value: number | null,
    reason?: string,
  ) {
    const key = String(entryId);
    setSavingKey(key);
    upsertEntry.mutate(
      { id: entryId, [field]: value, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          message.success(t('plan.toast_actual_saved'));
          setSavingKey(null);
        },
        onError: () => {
          message.error(t('plan.toast_save_error'));
          setSavingKey(null);
        },
      },
    );
  }

  function handleSubmitPlan(planId: number) {
    submitPlan.mutate(planId, {
      onSuccess: () => message.success(t('plan.toast_submitted')),
      onError: () => message.error(t('plan.toast_save_error')),
    });
  }

  function handleInitializeWeek() {
    if (!activeSeason || !weekNumber || !year) return;
    initWeek.mutate(
      { season: activeSeason.id, week_number: weekNumber, year },
      { onSuccess: () => message.success(t('plan.toast_initialized')) },
    );
  }

  // ─── Column definitions (normal view: blocks as rows) ─────────────────────

  const dayColumns = DAYS.map((day, di) => {
    const colDate = weekMonday.add(di, 'day');
    const colDateStr = colDate.format('YYYY-MM-DD');
    return {
      title: (
        <div style={{ textAlign: 'center', lineHeight: '16px' }}>
          <div>{t(`plan.${day}`)}</div>
          <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 400 }}>
            {colDate.format('DD.MM')}
          </div>
        </div>
      ),
      key: `${day}_cell`,
      width: 120,
      render: (_: unknown, row: IWeeklyHarvestPlan) => {
        const entry = entriesByBlockDay.get(`${row.block}-${colDateStr}`);
        if (!entry) return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <HarvestCell
            entry={entry}
            config={config}
            canEditPlan={canEditPlanForEntry(entry)}
            canEditForecast={canEditForecastForEntry(entry)}
            canEditActual={canEditActualForEntry(entry)}
            onSave={handleCellSave}
            onCellClick={(id) => {
              const found = dayEntries.find((e) => e.id === id);
              if (found) setHistoryEntry(found);
            }}
            isAdmin={isAdmin}
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
      width: 130,
      render: (_: unknown, row: IWeeklyHarvestPlan) => (
        <div>
          <Tag color={isBlockManager && myBlockIds.has(row.block) ? 'gold' : 'blue'}>
            {row.block_code}
          </Tag>
          <div style={{ color: '#8c8c8c', fontSize: 11, marginTop: 2 }}>{row.block_name}</div>
        </div>
      ),
    },
    ...dayColumns,
    ...(isCurrentOrFutureWeek
      ? [
          {
            title: t('plan.actions'),
            key: 'actions',
            fixed: 'right' as const,
            width: 100,
            render: (_: unknown, row: IWeeklyHarvestPlan) => {
              const canSubmit = !row.submitted_at && hasBlockPermission(row.block);
              if (!canSubmit) {
                return row.submitted_at ? (
                  <Tag color="success" style={{ fontSize: 11 }}>
                    {t('plan.status_submitted')}
                  </Tag>
                ) : null;
              }
              return (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  loading={submitPlan.isPending}
                  onClick={() => handleSubmitPlan(row.id)}
                >
                  {t('plan.submit')}
                </Button>
              );
            },
          },
        ]
      : []),
  ];

  // ─── Transposed view (days as rows, blocks as columns) ────────────────────

  interface ITransposedRow {
    key: string;
    day: Day;
    dayLabel: string;
    dateStr: string;
  }

  const transposedData: ITransposedRow[] = DAYS.map((day, di) => {
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
          </div>
        ),
        key: p.block_code,
        width: 130,
        onCell: () => ({ style: isMine ? { backgroundColor: '#fffbe6' } : undefined }),
        onHeaderCell: () => ({ style: isMine ? { backgroundColor: '#fffbe6' } : undefined }),
        render: (_: unknown, row: ITransposedRow) => {
          const entry = entriesByBlockDay.get(`${p.block}-${row.dateStr}`);
          if (!entry) return <span style={{ color: '#bfbfbf' }}>—</span>;
          return (
            <HarvestCell
              entry={entry}
              config={config}
              canEditPlan={canEditPlanForEntry(entry)}
              canEditForecast={canEditForecastForEntry(entry)}
              canEditActual={canEditActualForEntry(entry)}
              onSave={handleCellSave}
              onCellClick={(id) => {
                const found = dayEntries.find((e) => e.id === id);
                if (found) setHistoryEntry(found);
              }}
              isAdmin={isAdmin}
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
        {DAYS.map((day, di) => {
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
                <div style={{ color: '#1677ff', fontSize: 12 }}>{fmtKg(planTotal || null)}</div>
                {actualTotal > 0 && (
                  <div style={{ color: '#52c41a', fontSize: 12 }}>{fmtKg(actualTotal)}</div>
                )}
              </div>
            </Table.Summary.Cell>
          );
        })}
        {isCurrentOrFutureWeek && <Table.Summary.Cell index={7} />}
      </Table.Summary.Row>
    );
  }

  function renderTransposedSummary() {
    return (
      <>
        <Table.Summary.Row style={{ fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>
            <span style={{ color: '#1677ff' }}>{t('plan.total')} {t('plan.plan')}</span>
          </Table.Summary.Cell>
          {plans.map((p, i) => {
            const blockTotal = DAYS.reduce((s, _, di) => {
              const colDate = weekMonday.add(di, 'day');
              const e = entriesByBlockDay.get(`${p.block}-${colDate.format('YYYY-MM-DD')}`);
              return s + num(e?.plan_value);
            }, 0);
            return (
              <Table.Summary.Cell key={`tp_${p.id}`} index={1 + i}>
                <span style={{ color: '#1677ff' }}>{fmtKg(blockTotal || null)}</span>
              </Table.Summary.Cell>
            );
          })}
        </Table.Summary.Row>
        <Table.Summary.Row style={{ fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>
            <span style={{ color: '#52c41a' }}>{t('plan.total')} {t('plan.actual')}</span>
          </Table.Summary.Cell>
          {plans.map((p, i) => {
            const blockTotal = DAYS.reduce((s, _, di) => {
              const colDate = weekMonday.add(di, 'day');
              const e = entriesByBlockDay.get(`${p.block}-${colDate.format('YYYY-MM-DD')}`);
              return s + num(e?.actual_value);
            }, 0);
            return (
              <Table.Summary.Cell key={`ta_${p.id}`} index={1 + i}>
                <span style={{ color: '#52c41a' }}>{fmtKg(blockTotal || null)}</span>
              </Table.Summary.Cell>
            );
          })}
        </Table.Summary.Row>
      </>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const showInitialize = plans.length === 0 && !isLoading && isManager && activeSeason;

  return (
    <div>
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('plan.title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('plan.week')} {weekNumber} · {year} · {plans.length} {t('plan.blocks')}
            {activeSeason && <span> · {activeSeason.name}</span>}
          </Text>
        </div>
        <Space>
          <Button
            icon={<LeftOutlined />}
            onClick={() => setSelectedWeek((w) => (w ?? dayjs()).subtract(1, 'week'))}
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
          {showInitialize && (
            <Button type="primary" loading={initWeek.isPending} onClick={handleInitializeWeek}>
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
        <Flex gap={12} style={{ marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.total_plan')}
              value={totalPlan}
              suffix="kg"
              valueStyle={{ color: '#1677ff', fontSize: 20 }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.total_forecast')}
              value={totalForecast}
              suffix="kg"
              valueStyle={{ color: '#fa8c16', fontSize: 20 }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.total_actual')}
              value={totalActual}
              suffix="kg"
              valueStyle={{ color: '#52c41a', fontSize: 20 }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.est_trucks')}
              value={estTrucks}
              valueStyle={{ color: '#722ed1', fontSize: 20 }}
              suffix={t('plan.trucks_suffix')}
            />
          </Card>
        </Flex>
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
                isBlockManager && myBlockIds.has(row.block) ? '#fffbe6' : undefined,
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
                  isManager={!!isManager}
                  weekMonday={weekMonday}
                  totalPlanKg={totalPlan}
                  dayTotals={dayPlanTotals}
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
    </div>
  );
}
