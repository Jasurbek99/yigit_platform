import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Row,
  Select,
  Statistic,
  Tabs,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useSeasons } from '@/hooks/useAdmin';
import { useQuotaDashboard, useQuotaIssuances } from '@/hooks/useQuotaDashboard';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage, canDo } from '@/utils/permissions';
import { QuotaPerFirmTable } from './QuotaPerFirmTable';
import { QuotaVisualBars } from './QuotaVisualBars';
import { QuotaWeeklyFlow } from './QuotaWeeklyFlow';
import { LocalSellPlanGrid } from './LocalSellPlanGrid';
import { QuotaIssuancesList, computeExpiry } from './QuotaIssuancesList';
import type { ISeason } from '@/types';

dayjs.extend(isoWeek);

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

// ─── Period state ─────────────────────────────────────────────────────────────

type PeriodMode = 'season' | 'month' | 'week' | 'custom';

interface IPeriodState {
  mode: PeriodMode;
  monthKey: string | null;   // "YYYY-M"
  weekKey: string | null;    // "YYYY-WW"
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

// ─── Month selector options from season ──────────────────────────────────────

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

// ─── KPI Cards ────────────────────────────────────────────────────────────────

interface IKpiCardProps {
  title: string;
  value: number;
  suffix?: string;
  extra?: string;
  color?: string;
  loading?: boolean;
}

function KpiCard({ title, value, suffix = ' kg', extra, color, loading }: IKpiCardProps) {
  return (
    <Card size="small" loading={loading} styles={{ body: { padding: '12px 16px' } }}>
      <Statistic
        title={<span style={{ fontSize: 12, color: '#8c8c8c' }}>{title}</span>}
        value={value}
        suffix={suffix}
        valueStyle={{ fontSize: 18, fontWeight: 700, color }}
        formatter={(v) => Number(v).toLocaleString()}
      />
      {extra && (
        <Text style={{ fontSize: 12, color: '#8c8c8c' }}>{extra}</Text>
      )}
    </Card>
  );
}


// ─── Main page ────────────────────────────────────────────────────────────────

export default function QuotaDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const canAddIssuance = canDo(user, 'quota_issuance', 'create');
  const canSeeFullQuota = canSeePage(user, 'export.quota');
  const canSeeLocalSell = canSeePage(user, 'export.quota.local_sell');

  // Season selection
  const { data: seasons = [] } = useSeasons();
  const activeSeason = seasons.find((s) => s.is_active) ?? seasons[0];
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | undefined>(undefined);
  const seasonId = selectedSeasonId ?? activeSeason?.id;
  const currentSeason = seasons.find((s) => s.id === seasonId);

  // Period selection
  const [period, setPeriod] = useState<IPeriodState>({
    mode: 'season',
    monthKey: null,
    weekKey: null,
    customFrom: null,
    customTo: null,
  });

  // Product type filter
  const [productType, setProductType] = useState<string>('tomato');

  // Modal
  const navigate = useNavigate();

  // Active tab
  const defaultTab = canSeeFullQuota ? 'per_firm' : 'local_sell';
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

  // Build period dropdown options: All Season + months + weeks
  const periodOptions = useMemo(() => {
    const opts: Array<{ label: string; value: string }> = [
      { label: t('quota_dashboard.all_season'), value: 'season' },
    ];
    // Months from season date range
    for (const mo of buildMonthOptions(currentSeason)) {
      opts.push({ label: mo.label, value: `month:${mo.value}` });
    }
    // Weeks from data
    for (const w of weeklyFlow) {
      opts.push({ label: `W${w.week}`, value: `week:${w.year}-${w.week}` });
    }
    return opts;
  }, [currentSeason, weeklyFlow, t]);

  const periodSelectValue = useMemo(() => {
    if (period.mode === 'month' && period.monthKey) return `month:${period.monthKey}`;
    if (period.mode === 'week' && period.weekKey) return `week:${period.weekKey}`;
    if (period.mode === 'custom') return 'custom';
    return 'season';
  }, [period]);

  function handlePeriodChange(val: string) {
    if (val === 'season') {
      setPeriod({ mode: 'season', monthKey: null, weekKey: null, customFrom: null, customTo: null });
    } else if (val.startsWith('month:')) {
      setPeriod({ mode: 'month', monthKey: val.slice(6), weekKey: null, customFrom: null, customTo: null });
    } else if (val.startsWith('week:')) {
      setPeriod({ mode: 'week', monthKey: null, weekKey: val.slice(5), customFrom: null, customTo: null });
    }
  }

  function handleCustomRange(dates: [Dayjs | null, Dayjs | null] | null) {
    if (!dates || !dates[0] || !dates[1]) {
      setPeriod({ mode: 'season', monthKey: null, weekKey: null, customFrom: null, customTo: null });
      return;
    }
    setPeriod({
      mode: 'custom',
      monthKey: null,
      weekKey: null,
      customFrom: dates[0].format('YYYY-MM-DD'),
      customTo: dates[1].format('YYYY-MM-DD'),
    });
  }

  const seasonOptions = seasons.map((s) => ({ value: s.id, label: s.name }));

  const issuedPct =
    kpis && kpis.expected_kg > 0
      ? ((kpis.issued_kg / kpis.expected_kg) * 100).toFixed(1)
      : null;

  const allTabItems = [
    canSeeFullQuota && {
      key: 'all_quotas',
      label: t('quota_dashboard.tab_all_quotas'),
      children: <QuotaIssuancesList />,
    },
    canSeeFullQuota && {
      key: 'per_firm',
      label: t('quota_dashboard.tab_per_firm'),
      children: <QuotaPerFirmTable data={perFirm} expiredPerFirm={expiredStats.perFirmExpired} />,
    },
    canSeeFullQuota && {
      key: 'visual',
      label: t('quota_dashboard.tab_visual'),
      children: <QuotaVisualBars data={perFirm} />,
    },
    canSeeFullQuota && {
      key: 'weekly',
      label: t('quota_dashboard.tab_weekly'),
      children: <QuotaWeeklyFlow data={weeklyFlow} />,
    },
    (canSeeFullQuota || canSeeLocalSell) && {
      key: 'local_sell',
      label: t('quota_dashboard.tab_local_sell'),
      children: <LocalSellPlanGrid />,
    },
  ].filter(Boolean) as { key: string; label: string; children: React.ReactNode }[];
  const tabItems = allTabItems;

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

      {/* Period selector row — clean dropdowns */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Select
          value={seasonId}
          onChange={(v) => {
            setSelectedSeasonId(v);
            setPeriod({ mode: 'season', monthKey: null, weekKey: null, customFrom: null, customTo: null });
          }}
          options={seasonOptions}
          placeholder={t('quota_dashboard.season')}
          style={{ width: 140 }}
          size="small"
        />

        <Select
          value={periodSelectValue}
          onChange={handlePeriodChange}
          options={periodOptions}
          style={{ width: 170 }}
          size="small"
          showSearch
          optionFilterProp="label"
        />

        <RangePicker
          size="small"
          value={
            period.mode === 'custom' && period.customFrom && period.customTo
              ? [dayjs(period.customFrom), dayjs(period.customTo)]
              : null
          }
          onChange={(dates) => handleCustomRange(dates as [Dayjs | null, Dayjs | null] | null)}
          placeholder={[t('quota_dashboard.date_from'), t('quota_dashboard.date_to')]}
          style={{ width: 240 }}
        />

        <Select
          value={productType}
          onChange={(v) => setProductType(v)}
          options={[
            { label: t('quota_dashboard.product_tomato'), value: 'tomato' },
            { label: t('quota_dashboard.product_pepper'), value: 'pepper' },
          ]}
          style={{ width: 130 }}
          size="small"
        />
      </div>

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

      {/* KPI Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <KpiCard
            title={t('quota_dashboard.kpi_sales')}
            value={kpis?.local_sales_kg ?? 0}
            color="#1677ff"
            loading={isLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard
            title={t('quota_dashboard.kpi_expected')}
            value={kpis?.expected_kg ?? 0}
            color="#52c41a"
            loading={isLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard
            title={t('quota_dashboard.kpi_issued')}
            value={kpis?.issued_kg ?? 0}
            color="#722ed1"
            extra={issuedPct ? `${issuedPct}%` : undefined}
            loading={isLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard
            title={t('quota_dashboard.kpi_not_given')}
            value={kpis?.not_given_kg ?? 0}
            color={kpis && kpis.not_given_kg > 0 ? '#ff4d4f' : undefined}
            extra={kpis ? `${Number(kpis.not_given_pct).toFixed(1)}%` : undefined}
            loading={isLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard
            title={t('quota_dashboard.kpi_used')}
            value={kpis?.used_kg ?? 0}
            color="#13c2c2"
            loading={isLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard
            title={t('quota_dashboard.kpi_unused')}
            value={kpis?.unused_kg ?? 0}
            color={kpis && kpis.unused_kg > 0 ? '#fa8c16' : undefined}
            extra={kpis ? `${Number(kpis.unused_pct).toFixed(1)}%` : undefined}
            loading={isLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard
            title={t('quota_dashboard.kpi_expired_unused')}
            value={expiredStats.totalExpiredKg}
            color={expiredStats.totalExpiredKg > 0 ? '#ff4d4f' : undefined}
            loading={isLoading}
          />
        </Col>
      </Row>

      {/* Tabs */}
      <Card styles={{ body: { padding: '0 16px 16px' } }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="small"
        />
      </Card>

      {/* Add Issuance Modal */}
    </div>
  );
}
