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
import { useQuotaDashboard, useQuotaIssuances } from '@/hooks/useQuotaDashboard';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage, canDo } from '@/utils/permissions';
import { displayWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { QuotaPerFirmTable } from './QuotaPerFirmTable';
import { QuotaVisualBars } from './QuotaVisualBars';
import { QuotaWeeklyFlow } from './QuotaWeeklyFlow';
import { LocalSellPlanGrid } from './LocalSellPlanGrid';
import { QuotaIssuancesList, computeExpiry } from './QuotaIssuancesList';
import { QuotaUsageTab } from './QuotaUsageTab';
import type { ISeason } from '@/types';

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
    <span style={{ fontSize: 12, color: '#8c8c8c' }}>
      {label}{' '}
      <Tooltip title={tip}>
        <QuestionCircleOutlined style={{ fontSize: 10, color: '#bfbfbf', cursor: 'help' }} />
      </Tooltip>
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function QuotaDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const canAddIssuance = canDo(user, 'quota_issuance', 'create');
  const canSeeQuota = canSeePage(user, 'export.quota');
  const canSeeLocalSell = canSeePage(user, 'export.quota.local_sell');
  // Full analytics: comparison tabs (Firm Chart, Weekly Trend) — export_manager/director
  const canSeeAnalytics = canDo(user, 'local_sell_plan', 'view');

  // Season selection
  const { data: seasons = [] } = useSeasons();
  const activeSeason = seasons.find((s) => s.is_active) ?? seasons[0];
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | undefined>(undefined);
  const seasonId = selectedSeasonId ?? activeSeason?.id;
  const currentSeason = seasons.find((s) => s.id === seasonId);

  // Period selection
  const [period, setPeriod] = useState<IPeriodState>(EMPTY_PERIOD);

  // Product type filter
  const [productType, setProductType] = useState<string>('tomato');

  // Weight unit toggle (display)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');

  const navigate = useNavigate();

  // Active tab — document_team defaults to issuance log, others to firm breakdown
  const defaultTab = canSeeQuota ? 'all_quotas' : 'local_sell';
  const [activeTab, setActiveTab] = useState(defaultTab);

  const { date_from, date_to } = useMemo(
    () => periodToDates(period, currentSeason),
    [period, currentSeason],
  );

  const { data, isLoading, isError } = useQuotaDashboard({
    season: seasonId ?? 0,
    date_from,
    date_to,
    product_type: productType,
  });
  const { data: issuances = [] } = useQuotaIssuances({ product_type: productType });

  const kpis = data?.kpis;
  const perFirm = data?.per_firm ?? [];
  const weeklyFlow = data?.weekly_flow ?? [];

  // Compute expired unused quota from issuances
  const todayStr = dayjs().format('YYYY-MM-DD');
  const expiredStats = useMemo(() => {
    const now = dayjs(todayStr);
    let totalExpiredKg = 0;
    const perFirmExpired: Record<number, number> = {};
    for (const iss of issuances) {
      const expiry = computeExpiry(iss.issue_date, iss.validity);
      if (expiry.isBefore(now, 'day')) {
        for (const a of iss.allocations) {
          totalExpiredKg += a.kg_quota;
          perFirmExpired[a.export_firm] = (perFirmExpired[a.export_firm] ?? 0) + a.kg_quota;
        }
      }
    }
    return { totalExpiredKg, perFirmExpired };
  }, [issuances, todayStr]);

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

  const seasonOptions = seasons.map((s) => ({ value: s.id, label: s.name }));

  const statFmt = (v: number | string) =>
    Number(v).toLocaleString('ru-RU', { maximumFractionDigits: weightUnit === 'ton' ? 2 : 0 });

  const coveragePct =
    kpis && kpis.expected_kg > 0
      ? Math.round((kpis.issued_kg / kpis.expected_kg) * 100)
      : 0;

  // Tabs — role-based visibility:
  // document_team: Firm Breakdown (read-only) + Issuance Log
  // export_manager/director: all 4 tabs
  const tabItems = [
    canSeeQuota && {
      key: 'all_quotas',
      label: t('quota_dashboard.tab_issuance_log'),
      children: <QuotaIssuancesList weightUnit={weightUnit} />,
    },
    canSeeQuota && {
      key: 'quota_usage',
      label: t('quota_dashboard.tab_quota_usage'),
      children: <QuotaUsageTab weightUnit={weightUnit} />,
    },
    canSeeLocalSell && {
      key: 'local_sell',
      label: t('quota_dashboard.tab_local_sell'),
      children: <LocalSellPlanGrid />,
    },
    canSeeQuota && {
      key: 'per_firm',
      label: t('quota_dashboard.tab_firm_breakdown'),
      children: <QuotaPerFirmTable data={perFirm} expiredPerFirm={expiredStats.perFirmExpired} weightUnit={weightUnit} />,
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
            {t('quota_dashboard.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('quota_dashboard.subtitle')}
          </Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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

      {/* ── Filter Panel (only for analytics tabs: per_firm, visual, weekly) ── */}
      {canSeeQuota && (activeTab === 'per_firm' || activeTab === 'visual' || activeTab === 'weekly') && <div
        style={{
          background: '#fafafa',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
        }}
      >
        {/* Row 1: Season + Product Type */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 10 }}>
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

        {/* Row 2: Period mode segmented + contextual sub-control */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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
        </div>
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
            color: '#ff4d4f',
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
              valueStyle={{ fontSize: 22, fontWeight: 700, color: '#1677ff' }}
              formatter={statFmt}
            />
          </Card>
        </Col>

        {/* Arrow */}
        <Col xs={0} md={1} style={{ textAlign: 'center' }}>
          <RightOutlined style={{ fontSize: 16, color: '#d9d9d9' }} />
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
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: '#52c41a' }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_issued')} tip={t('quota_dashboard.kpi_issued_tip')} />}
                  value={displayWeight(kpis?.issued_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: '#722ed1' }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_not_given')} tip={t('quota_dashboard.kpi_not_given_tip')} />}
                  value={displayWeight(kpis?.not_given_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: kpis && kpis.not_given_kg > 0 ? '#ff4d4f' : undefined }}
                  formatter={statFmt}
                />
              </Col>
            </Row>
            <Progress
              percent={coveragePct}
              size="small"
              strokeColor={coveragePct >= 80 ? '#52c41a' : coveragePct >= 50 ? '#fa8c16' : '#ff4d4f'}
              format={(pct) => `${pct}% ${t('quota_dashboard.coverage')}`}
              style={{ marginTop: 8 }}
            />
          </Card>
        </Col>

        {/* Arrow */}
        <Col xs={0} md={1} style={{ textAlign: 'center' }}>
          <RightOutlined style={{ fontSize: 16, color: '#d9d9d9' }} />
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
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: '#13c2c2' }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_unused')} tip={t('quota_dashboard.kpi_unused_tip')} />}
                  value={displayWeight(kpis?.unused_kg ?? 0, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: kpis && kpis.unused_kg > 0 ? '#fa8c16' : undefined }}
                  formatter={statFmt}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<KpiLabel label={t('quota_dashboard.kpi_expired_unused')} tip={t('quota_dashboard.kpi_expired_tip')} />}
                  value={displayWeight(expiredStats.totalExpiredKg, weightUnit)}
                  suffix={weightSuffix(weightUnit)}
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: expiredStats.totalExpiredKg > 0 ? '#ff4d4f' : undefined }}
                  formatter={statFmt}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>}

      {/* ── Dashboard Tabs ── */}
      {(canSeeQuota || canSeeLocalSell) && (
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
