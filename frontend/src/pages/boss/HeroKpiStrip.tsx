import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Tag, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { EChart } from '@/components/EChart';
import type { BossPeriod, IBossKpiCard } from '@/hooks/useBossDashboard';
import { useBossSummary } from '@/hooks/useBossDashboard';

const { Text } = Typography;

interface IKpiCardProps {
  labelKey: string;
  card: IBossKpiCard | undefined;
  isLoading: boolean;
  format?: 'usd' | 'int' | 'pct';
  onClick?: () => void;
  showPlaceholder?: boolean;
}

function formatValue(value: number, format: 'usd' | 'int' | 'pct'): string {
  if (format === 'usd') return `$${(value / 1_000_000).toFixed(1)}M`;
  if (format === 'pct') return `${value.toFixed(1)}%`;
  return value.toLocaleString();
}

function buildSparkOption(points: number[]) {
  return {
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: 'category' as const, show: false, data: points.map((_, i) => String(i)) },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'line' as const,
        data: points,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: '#1677ff' },
        areaStyle: { color: 'rgba(22,119,255,0.08)' },
      },
    ],
  };
}

function KpiCard({ labelKey, card, isLoading, format = 'int', onClick, showPlaceholder }: IKpiCardProps) {
  const { t } = useTranslation();

  const isPlaceholder = showPlaceholder || card?.is_placeholder;
  const level = card?.level;

  const bgColor =
    level === 'alert' ? '#fff2f0' : level === 'warn' ? '#fffbe6' : '#fff';
  const borderColor =
    level === 'alert' ? '#ff4d4f' : level === 'warn' ? '#faad14' : '#f0f0f0';

  const deltaColor = (card?.delta_pct ?? 0) >= 0 ? '#52c41a' : '#ff4d4f';
  const deltaPrefix = (card?.delta_pct ?? 0) >= 0 ? '+' : '';

  if (isLoading) {
    return (
      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    );
  }

  const displayValue = card ? formatValue(card.value, format) : '—';

  return (
    <Tooltip title={isPlaceholder ? t('boss_dashboard.placeholder_p4') : undefined}>
      <Card
        size="small"
        onClick={onClick}
        style={{
          borderRadius: 8,
          border: `1px solid ${borderColor}`,
          background: bgColor,
          cursor: onClick ? 'pointer' : 'default',
          position: 'relative',
          overflow: 'hidden',
        }}
        styles={{ body: { padding: '12px 14px' } }}
      >
        {isPlaceholder && (
          <Tag
            color="orange"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              fontSize: 10,
              lineHeight: '16px',
              padding: '0 4px',
              zIndex: 1,
            }}
          >
            Demo
          </Tag>
        )}
        <Text
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: '#8c8c8c',
            display: 'block',
            marginBottom: 2,
          }}
        >
          {t(labelKey)}
        </Text>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
          {displayValue}
        </div>
        {card?.delta_pct !== null && card?.delta_pct !== undefined && (
          <Text style={{ fontSize: 12, color: deltaColor }}>
            {deltaPrefix}{card.delta_pct.toFixed(1)}%
          </Text>
        )}
        {card?.sparkline && card.sparkline.length > 0 && (
          <div style={{ marginTop: 8, height: 36 }}>
            <EChart option={buildSparkOption(card.sparkline)} height={36} />
          </div>
        )}
      </Card>
    </Tooltip>
  );
}

// ─── Responsive grid styles injected once ────────────────────────────────────
const GRID_STYLE = `
  .boss-kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 16px; }
  @media (max-width: 992px) { .boss-kpi-grid { grid-template-columns: repeat(3, 1fr) !important; } }
  @media (max-width: 576px) { .boss-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; } }
`;

interface IHeroKpiStripProps {
  period: BossPeriod;
}

export function HeroKpiStrip({ period }: IHeroKpiStripProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossSummary(period);

  return (
    <>
      <style>{GRID_STYLE}</style>
      <div className="boss-kpi-grid">
        <KpiCard
          labelKey="boss_dashboard.kpi.revenue"
          card={data?.kpis?.revenue}
          isLoading={isLoading}
          format="usd"
        />
        <KpiCard
          labelKey="boss_dashboard.kpi.margin"
          card={data?.kpis?.margin}
          isLoading={isLoading}
          format="usd"
        />
        <KpiCard
          labelKey="boss_dashboard.kpi.debt"
          card={data?.kpis?.debt}
          isLoading={isLoading}
          format="usd"
          showPlaceholder
        />
        <KpiCard
          labelKey="boss_dashboard.kpi.today_loaded"
          card={data?.kpis?.today_loaded}
          isLoading={isLoading}
          format="int"
          onClick={() => navigate('/export/shipments?status=yuklenme&date=today')}
        />
        <KpiCard
          labelKey="boss_dashboard.kpi.in_transit"
          card={data?.kpis?.in_transit}
          isLoading={isLoading}
          format="int"
          onClick={() => navigate('/export/shipments?status=yyolda')}
        />
        <KpiCard
          labelKey="boss_dashboard.kpi.quota_used"
          card={data?.kpis?.quota_used}
          isLoading={isLoading}
          format="pct"
          onClick={() => navigate('/export/quota')}
        />
        {!isLoading && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'right', fontSize: 11, color: '#bfbfbf' }}>
            {t('boss_dashboard.last_updated')}
          </div>
        )}
      </div>
    </>
  );
}
