import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Progress,
  Row,
  Segmented,
  Select,
  Statistic,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import { PlusOutlined, QuestionCircleOutlined, RightOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useSeasons } from '@/hooks/useAdmin';
import { useQuotaDashboard } from '@/hooks/useQuotaDashboard';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { displayWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { QuotaPerFirmTable } from './QuotaPerFirmTable';
import { QuotaFirmSummaryTable } from './QuotaFirmSummaryTable';
import { QuotaVisualBars } from './QuotaVisualBars';
import { QuotaWeeklyFlow } from './QuotaWeeklyFlow';
import { LocalSellPlanGrid } from './LocalSellPlanGrid';
import { QuotaIssuancesList } from './QuotaIssuancesList';
import { quotaPanelAccess, seasonsVisibleTo } from './QuotaDashboard.helpers';
import { QuotaUsageTab } from './QuotaUsageTab';
import type { ISeason } from '@/types';
import { COLORS } from '@/constants/styles';

dayjs.extend(isoWeek);

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

// ─── Period state ─────────────────────────────────────────────────────────────

type PeriodMode = 'season' | 'month' | 'week' | 'custom';

interface IPeriodState {
  mode: PeriodMode;
  monthKey: string | null;
  weekKey: string | null;
  customFrom: string | null;
  customTo: string | null;
}

function periodToDates(
  state: IPeriodState,
  season: ISeason | undefined,
): { date_from?: string; date_to?: string } {
  if (state.mode === 'season' || !season) return {};

  if (state.mode === 'custom') {
    return {
      date_from: state.customFrom ?? undefined,
      date_to: state.customTo ?? undefined,
    };
  }

  if (state.mode === 'month' && state.monthKey) {
    const [year, month] = state.monthKey.split('-').map(Number);
    const start = dayjs().year(year).month(month - 1).startOf('month');
    const end = start.endOf('month');
    return { date_from: start.format('YYYY-MM-DD'), date_to: end.format('YYYY-MM-DD') };
  }

  if (state.mode === 'week' && state.weekKey) {
    const [year, week] = state.weekKey.split('-').map(Number);
    const start = dayjs().year(year).isoWeek(week).isoWeekday(1);
    const end = start.add(5, 'day'); // Mon–Sat
    return { date_from: start.format('YYYY-MM-DD'), date_to: end.format('YYYY-MM-DD') };
  }

  return {};
}

function buildMonthOptions(season: ISeason | undefined) {
  if (!season) return [];
  const start = dayjs(season.start_date);
  const end = dayjs(season.end_date);
  const options: Array<{ label: string; value: string }> = [];
  let cur = start.startOf('month');
  while (cur.isBefore(end) || cur.isSame(end, 'month')) {
    options.push({ label: cur.format('MMM YYYY'), value: `${cur.year()}-${cur.month() + 1}` });
    cur = cur.add(1, 'month');
  }
  return options;
}

const EMPTY_PERIOD: IPeriodState = { mode: 'season', monthKey: null, weekKey: null, customFrom: null, customTo: null };

// ─── KPI label with tooltip ──────────────────────────────────────────────────

function KpiLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <span style={{ fontSize: 12, color: COLORS.textSecondary }}>
      {label}{' '}
      <Tooltip title={tip}>
        <QuestionCircleOutlined style={{ fontSize: 10, color: COLORS.textMuted, cursor: 'help' }} />
      </Tooltip>
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function QuotaDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const canAddIssuance = canDo(user, 'quota_issuance', 'create');
  // Resource-gated, not page-gated — see `quotaPanelAccess`. A seller holds
  // only `export.quota.local_sell` and must see the sell plan and nothing else.
  const { canSeeQuota, canSeeLocalSell, canSeeAnalytics } = quotaPanelAccess(user);

  // Season selection. Closed seasons are hidden from anyone without
  // `closed_season.can_view` — the backend resolves this filter's `?season=`
  // through `resolve_season()`, so picking one would 403 and the page would
  // show nothing but "Failed to load quota data". The DEFAULT comes from the
  // same filtered list: during the close→open gap there is no ACTIVE season,
  // and falling back to `seasons[0]` would silently default an unpermitted
  // user onto the most recent closed one.
  const { data: seasons = [] } = useSeasons();
  const selectableSeasons = useMemo(
    () => seasonsVisibleTo(seasons, user?.can_view_closed_seasons ?? false),
    [seasons, user?.can_view_closed_seasons],
  );
  const activeSeason = selectableSeasons.find((s) => s.is_active) ?? selectableSeasons[0];
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | undefined>(undefined);
  const seasonId = selectedSeasonId ?? activeSeason?.id;
  const currentSeason = selectableSeasons.find((s) => s.id === seasonId);

  // Period selection
  const [period, setPeriod] = useState<IPeriodState>(EMPTY_PERIOD);

  // Product type filter
  const [productType, setProductType] = useState<string>('tomato');

  // Weight unit toggle (display)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');

  const navigate = useNavigate();

  // Active tab — derive from the first visible tab to avoid pointing at a hidden one.
  // `quota_usage` leads: it is the day-to-day screen (what each truck spent),
  // while the issuance log is consulted occasionally. Must stay in step with the
  // order of `tabItems` below, or the first tab shown is not the one opened.
  const tabOrder = [
    canSeeQuota && 'quota_usage',
    canSeeLocalSell && 'local_sell',
  ].filter(Boolean) as string[];
  const defaultTab = tabOrder[0] ?? 'all_quotas';
  const [activeTab, setActiveTab] = useState(defaultTab);

  const { date_from, date_to } = useMemo(
    () => periodToDates(period, currentSeason),
    [period, currentSeason],
  );

  const { data, isLoading, isError } = useQuotaDashboard(
    {
      season: seasonId ?? 0,
      date_from,
      date_to,
      product_type: productType,
    },
    { enabled: canSeeQuota },
  );

  const kpis = data?.kpis;
  const perFirm = data?.per_firm ?? [];
  const weeklyFlow = useMemo(() => data?.weekly_flow ?? [], [data?.weekly_flow]);

  // Build week options from weekly flow data
  const weekOptions = useMemo(
    () => weeklyFlow.map((w) => ({ label: `W${w.week}`, value: `${w.year}-${w.week}` })),
    [weeklyFlow],
  );

  const monthOptions = useMemo(() => buildMonthOptions(currentSeason), [currentSeason]);

  // Period mode handlers
  function handlePeriodModeChange(mode: PeriodMode) {
    if (mode === 'season') {
      setPeriod(EMPTY_PERIOD);
    } else {
      setPeriod({ ...EMPTY_PERIOD, mode });
    }
  }

  function handleMonthChange(val: string) {
    setPeriod({ ...EMPTY_PERIOD, mode: 'month', monthKey: val });
  }

  function handleWeekChange(val: string) {
    setPeriod({ ...EMPTY_PERIOD, mode: 'week', weekKey: val });
  }

  function handleCustomRange(dates: [Dayjs | null, Dayjs | null] | null) {
    if (!dates || !dates[0] || !dates[1]) {
      setPeriod(EMPTY_PERIOD);
      return;
    }
    setPeriod({
      ...EMPTY_PERIOD,
      mode: 'custom',
      customFrom: dates[0].format('YYYY-MM-DD'),
      customTo: dates[1].format('YYYY-MM-DD'),
    });
  }

  const seasonOptions = selectableSeasons.map((s) => ({ value: s.id, label: s.name }));

  const statFmt = (v: number | string) =>
    Number(v).toLocaleString('ru-RU', { maximumFractionDigits: weightUnit === 'ton' ? 2 : 0 });

  const coveragePct =
    kpis && kpis.expected_kg > 0
      ? Math.round((kpis.issued_kg / kpis.expected_kg) * 100)
      : 0;

  // Tabs — role-based visibility:
  // document_team: Firm Breakdown (read-only) + Issuance Log
  // export_manager/director: every tab
  // Order matters: `tabOrder` above picks the default from the first visible key,
  // so moving an entry here without moving it there opens a different tab than
  // the one sitting first.
  const tabItems = [
    canSeeQuota && {
      key: 'quota_usage',
      label: t('quota_dashboard.tab_quota_usage'),
      children: <QuotaUsageTab weightUnit={weightUnit} productType={productType} />,
    },
    canSeeQuota && {
      key: 'firm_quota',
      label: t('quota_dashboard.tab_firm_quota'),
      children: (
        <QuotaFirmSummaryTable
          seasonId={seasonId}
          productType={productType}
          weightUnit={weightUnit}
        />
      ),
    },
    canSeeQuota && {
      key: 'all_quotas',
      label: t('quota_dashboard.tab_issuance_log'),
      children: <QuotaIssuancesList weightUnit={weightUnit} />,
    },
    canSeeLocalSell && {
      key: 'local_sell',
      label: t('quota_dashboard.tab_local_sell'),
      children: <LocalSellPlanGrid />,
    },
    canSeeQuota && {
      key: 'per_firm',
      label: t('quota_dashboard.tab_firm_breakdown'),
      children: <QuotaPerFirmTable data={perFirm} weightUnit={weightUnit} />,
    },
    canSeeAnalytics && {
      key: 'visual',
      label: t('quota_dashboard.tab_firm_chart'),
      children: <QuotaVisualBars data={perFirm} weightUnit={weightUnit} />,
    },
    canSeeAnalytics && {
      key: 'weekly',
      label: t('quota_dashboard.tab_weekly_trend'),
      children: <QuotaWeeklyFlow data={weeklyFlow} weightUnit={weightUnit} />,
    },
  ].filter(Boolean) as { key: string; label: string; children: React.ReactNode }[];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t(canSeeQuota ? 'quota_dashboard.title' : 'quota_dashboard.title_local_sell')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t(canSeeQuota ? 'quota_dashboard.subtitle' : 'quota_dashboard.subtitle_local_sell')}
          </Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* kg/ton drives the quota widgets only — the sell plan grid is
              always kg, so this reads as a dead control without them. */}
          {canSeeQuota && (
            <>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('quota_dashboard.unit_label')}:</Text>
              <Segmented
                value={weightUnit}
                onChange={(v) => setWeightUnit(v as WeightUnit)}
                options={[
                  { label: t('quota_dashboard.kg'), value: 'kg' },
                  { label: t('quota_dashboard.ton'), value: 'ton' },
                ]}
                size="small"
              />
            </>
          )}
          {canAddIssuance && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/export/quota/add-issuance')}
            >
              {t('quota_dashboard.add_issuance')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Filter Panel (analytics tabs + firm_quota) ──
          `firm_quota` needs the season + product selectors but NOT the period
          row: it reports a live balance, and quota lives about a month, so a
          week/month filter would hide exactly the quota being asked about. */}
      {canSeeQuota && (activeTab === 'per_firm' || activeTab === 'visual' || activeTab === 'weekly' || activeTab === 'firm_quota') && <div
        style={{
          background: COLORS.bgLayout,
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
        }}
      >
        {/* Row 1: Season + Product Type */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: activeTab === 'firm_quota' ? 0 : 10 }}>
          <Select
            value={seasonId}
            onChange={(v) => {
              setSelectedSeasonId(v);
              setPeriod(EMPTY_PERIOD);
            }}
            options={seasonOptions}
            placeholder={t('quota_dashboard.season')}
            style={{ width: 160 }}
          />
          <Segmented
            value={productType}
            onChange={(v) => setProductType(v as string)}
            options={[
              { label: t('quota_dashboard.product_tomato'), value: 'tomato' },
              { label: t('quota_dashboard.product_pepper'), value: 'pepper' },
            ]}
          />
        </div>

        {/* Row 2: Period mode segmented + contextual sub-control.
            Hidden on the Firm Quota tab — see the panel comment above. */}
        {activeTab !== 'firm_quota' && <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Segmented
            value={period.mode}
            onChange={(v) => handlePeriodModeChange(v as PeriodMode)}
            options={[
              { label: t('quota_dashboard.filter_full_season'), value: 'season' },
              { label: t('quota_dashboard.filter_month'), value: 'month' },
              { label: t('quota_dashboard.filter_week'), value: 'week' },
              { label: t('quota_dashboard.filter_custom'), value: 'custom' },
            ]}
          />

          {period.mode === 'month' && (
            <Select
              value={period.monthKey}
              onChange={handleMonthChange}
              options={monthOptions}
              placeholder={t('quota_dashboard.filter_month')}
              style={{ width: 160 }}
              showSearch
              optionFilterProp="label"
            />
          )}

          {period.mode === 'week' && (
            <Select
              value={period.weekKey}
              onChange={handleWeekChange}
              options={weekOptions}
              placeholder={t('quota_dashboard.filter_week')}
              style={{ width: 130 }}
              showSearch
              optionFilterProp="label"
            />
          )}

          {period.mode === 'custom' && (
            <RangePicker
              value={
                period.customFrom && period.customTo
                  ? [dayjs(period.customFrom), dayjs(period.customTo)]
                  : null
              }
              onChange={(dates) => handleCustomRange(dates as [Dayjs | null, Dayjs | null] | null)}
              placeholder={[t('quota_dashboard.date_from'), t('quota_dashboard.date_to')]}
              style={{ width: 260 }}
            />
          )}
        </div>}
      </div>}

      {/* Error state */}
      {isError && (
        <div
          style={{
            padding: '12px 16px',
            background: '#fff1f0',
            border: '1px solid #ffa39e',
            borderRadius: 6,
            marginBottom: 16,
            color: COLORS.danger,
            fontSize: 13,
          }}
        >
          {t('quota_dashboard.error_load')}
        </div>
      )}

      {/* ── KPI Pipeline (visible to quota page users, not seller-only) ── */}
      {canSeeQuota && <Row gutter={12} align="middle" style={{ marginBottom: 16 }}>
        {/* INPUT */}
        <Col xs={24} md={6}>
          <Card size="small" loading={isLoading} styles={{ body: { padding: '12px 16px' } }}>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('quota_dashboard.kpi_section_input')}
            </Text>
            <Statistic
              title={<KpiLabel label={t('quota_dashboard.kpi_sales')} tip={t('quota_dashboard.kpi_sales_tip')} />}
              value={displayWeight(kpis?.local_sales_kg ?? 0, weightUnit)}
              suffix={weightSuffix(weightUnit)}
              styles={{ content: { fontSize: 22, fontWeight: 700, color: COLORS.primary } }}
              formatter={statFmt}
            />
          </Card>
        </Col>

        {/* Arrow */}
        <Col xs={0} md={1} style={{ textAlign: 'center' }}>
          <RightOutlined style={{ fontSize: 16, color: COLORS.borderLight }} />
        </Col>

        {/* ALLOCATION */}
        <Col xs={24} md={9}>
          <Card size="small" loading={isLoading} styles={{ body: { padding: '12px 16px' } }}>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('quota_dashboard.kpi_section_allocation')}
            </Text>
            <Row gutter={12}>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_expected')} tip={t('quota_dashboard.kpi_expected_tip')} />}
                  value={displayWeight(kpis?.expected_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  styles={{ content: { fontSize: 16, fontWeight: 600, color: COLORS.success } }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_issued')} tip={t('quota_dashboard.kpi_issued_tip')} />}
                  value={displayWeight(kpis?.issued_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  styles={{ content: { fontSize: 16, fontWeight: 600, color: COLORS.purple } }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_not_given')} tip={t('quota_dashboard.kpi_not_given_tip')} />}
                  value={displayWeight(kpis?.not_given_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  styles={{ content: { fontSize: 16, fontWeight: 600, color: kpis && kpis.not_given_kg > 0 ? COLORS.danger : undefined } }}
                  formatter={statFmt}
                />
              </Col>
            </Row>
            <Progress
              percent={coveragePct}
              size="small"
              strokeColor={coveragePct >= 80 ? COLORS.success : coveragePct >= 50 ? COLORS.orange : COLORS.danger}
              format={(pct) => `${pct}% ${t('quota_dashboard.coverage')}`}
              style={{ marginTop: 8 }}
            />
          </Card>
        </Col>

        {/* Arrow */}
        <Col xs={0} md={1} style={{ textAlign: 'center' }}>
          <RightOutlined style={{ fontSize: 16, color: COLORS.borderLight }} />
        </Col>

        {/* OUTCOME */}
        <Col xs={24} md={7}>
          <Card size="small" loading={isLoading} styles={{ body: { padding: '12px 16px' } }}>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('quota_dashboard.kpi_section_outcome')}
            </Text>
            <Row gutter={12}>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_used')} tip={t('quota_dashboard.kpi_used_tip')} />}
                  value={displayWeight(kpis?.used_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  styles={{ content: { fontSize: 16, fontWeight: 600, color: '#13c2c2' } }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_unused')} tip={t('quota_dashboard.kpi_unused_tip')} />}
                  value={displayWeight(kpis?.unused_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  styles={{ content: { fontSize: 16, fontWeight: 600, color: kpis && kpis.unused_kg > 0 ? COLORS.orange : undefined } }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_expired_unused')} tip={t('quota_dashboard.kpi_expired_tip')} />}
                  value={displayWeight(kpis?.expired_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  styles={{ content: { fontSize: 16, fontWeight: 600, color: kpis && kpis.expired_kg > 0 ? COLORS.danger : undefined } }}
                  formatter={statFmt}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>}

      {/* ── Dashboard Tabs ──
          One visible tab (the seller: sell plan only) renders bare. A tab strip
          with a single tab is chrome with no choice behind it, and `activeTab`
          is seeded from `useState(defaultTab)` — captured on FIRST render, when
          `user` may still be resolving — so a lone `<Tabs>` can end up pointing
          at a key that is not in `items` and render nothing at all. */}
      {tabItems.length === 1 && (
        <Card styles={{ body: { padding: 16 } }}>{tabItems[0].children}</Card>
      )}
      {tabItems.length > 1 && (
        <Card styles={{ body: { padding: '0 16px 16px' } }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            size="small"
          />
        </Card>
      )}

    </div>
  );
}
