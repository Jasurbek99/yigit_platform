import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Flex, Tag, Typography } from 'antd';
import { IconDownload } from '@tabler/icons-react';
import type { BossPeriod } from '@/hooks/useBossDashboard';
import { HeroKpiStrip } from './HeroKpiStrip';
import { RevenueChart } from './RevenueChart';
import { DebtBreakdown } from './DebtBreakdown';
import { RoutePnlTable } from './RoutePnlTable';
import { ComplianceStrip } from './ComplianceStrip';
import { QuotaGrid } from './QuotaGrid';
import { BlocksHeatmap } from './BlocksHeatmap';
import { TopCustomers } from './TopCustomers';
import { FirmRiskMatrix } from './FirmRiskMatrix';
import { AlertsPanel } from './AlertsPanel';
import { ProductionResults } from './ProductionResults';
import { ExportMarketByBlock } from './ExportMarketByBlock';
import { ReportsGrid } from './ReportsGrid';

const { Title, Text } = Typography;

const PERIODS: { key: BossPeriod; labelKey: string }[] = [
  { key: 'today', labelKey: 'boss_dashboard.period.today' },
  { key: 'week', labelKey: 'boss_dashboard.period.week' },
  { key: 'month', labelKey: 'boss_dashboard.period.month' },
  { key: 'season', labelKey: 'boss_dashboard.period.season' },
  { key: 'years5', labelKey: 'boss_dashboard.period.years5' },
];

export default function BossDashboard() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const period = (searchParams.get('period') as BossPeriod) ?? 'month';

  const handlePeriod = (p: BossPeriod) => {
    setSearchParams({ period: p });
  };

  const handleExportExcel = (section: string) => {
    window.open(`/api/v1/export/boss/export_excel/?section=${section}`, '_blank');
  };

  const handleExportPdf = (section: string) => {
    window.open(`/api/v1/export/boss/export_pdf/?section=${section}`, '_blank');
  };

  // Section slug = backend dispatch key. Display label key uses 'by_firm' (rename of legacy 'firms').
  const sections: Array<{ slug: string; labelKey: string }> = [
    { slug: 'monthly',         labelKey: 'monthly' },
    { slug: 'firms',           labelKey: 'by_firm' },
    { slug: 'routes',          labelKey: 'routes' },
    { slug: 'blocks',          labelKey: 'blocks' },
    { slug: 'seasons_compare', labelKey: 'seasons_compare' },
    { slug: 'audit',           labelKey: 'audit' },
  ];

  const exportMenuItems = sections.flatMap(({ slug, labelKey }) => [
    {
      key: `excel_${slug}`,
      label: `Excel — ${t(`boss_dashboard.reports.${labelKey}`)}`,
      onClick: () => handleExportExcel(slug),
    },
    {
      key: `pdf_${slug}`,
      label: `PDF — ${t(`boss_dashboard.reports.${labelKey}`)}`,
      onClick: () => handleExportPdf(slug),
    },
  ]);

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────── */}
      <Flex justify="space-between" align="flex-start" wrap="wrap" gap={12} style={{ marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {t('boss_dashboard.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('boss_dashboard.subtitle')}
          </Text>
        </div>
        <Flex align="center" gap={12} wrap="wrap">
          {/* Period pill switcher */}
          <Flex gap={4}>
            {PERIODS.map(({ key, labelKey }) => (
              <Button
                key={key}
                size="small"
                type={period === key ? 'primary' : 'default'}
                onClick={() => handlePeriod(key)}
                style={{ borderRadius: 20, fontSize: 12 }}
              >
                {t(labelKey)}
              </Button>
            ))}
          </Flex>

          {/* Export dropdown */}
          <Dropdown menu={{ items: exportMenuItems }} placement="bottomRight">
            <Button size="small" icon={<IconDownload size={14} />}>
              {t('boss_dashboard.export.excel')} / {t('boss_dashboard.export.pdf')}
            </Button>
          </Dropdown>

          {/* Role pill */}
          <Tag color="purple" style={{ margin: 0 }}>
            {t('roles.boss')} · {t('boss_dashboard.role_readonly')}
          </Tag>
        </Flex>
      </Flex>

      {/* ── Hero KPIs ────────────────────────────────────────────── */}
      <HeroKpiStrip period={period} />

      {/* ── Revenue + Debt (2-col) ────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <RevenueChart period={period} />
        <DebtBreakdown period={period} />
      </div>

      {/* ── Route P&L + Compliance (2-col) ───────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <RoutePnlTable period={period} />
        <ComplianceStrip period={period} />
      </div>

      {/* ── Quota Grid (full-width) ───────────────────────────── */}
      <QuotaGrid period={period} />

      {/* ── Blocks Heatmap + Top Customers (2-col) ────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <BlocksHeatmap period={period} />
        <TopCustomers period={period} />
      </div>

      {/* ── Risk Matrix + Alerts (2-col) ──────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <FirmRiskMatrix period={period} />
        <AlertsPanel />
      </div>

      {/* ── Production Results (full-width) ──────────────────── */}
      <ProductionResults period={period} />

      {/* ── Export Market by Block (full-width) ──────────────── */}
      <ExportMarketByBlock period={period} />

      {/* ── Reports Grid ─────────────────────────────────────── */}
      <ReportsGrid />
    </div>
  );
}
