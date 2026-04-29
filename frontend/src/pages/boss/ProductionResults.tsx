import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BossPeriod, IBossProductionRow } from '@/hooks/useBossDashboard';
import { useBossProduction } from '@/hooks/useBossDashboard';

const { Text } = Typography;

interface IProductionTableProps {
  rows: IBossProductionRow[];
  scope: 'daily' | 'seasonal';
  titleKey: string;
  onRowClick: (blockCode: string) => void;
}

function ProductionTable({ rows, scope, titleKey, onRowClick }: IProductionTableProps) {
  const { t } = useTranslation();

  const planKey: keyof IBossProductionRow   = scope === 'daily' ? 'plan_kg'   : 'monthly_plan_kg';
  const actualKey: keyof IBossProductionRow = scope === 'daily' ? 'actual_kg' : 'monthly_actual_kg';
  const pctKey: keyof IBossProductionRow    = scope === 'daily' ? 'pct'       : 'monthly_pct';

  const totalPlan = rows.reduce((s, r) => s + r[planKey], 0);
  const totalActual = rows.reduce((s, r) => s + r[actualKey], 0);
  const totalPct = totalPlan > 0 ? (totalActual / totalPlan) * 100 : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Yellow header strip */}
      <div
        style={{
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: '6px 6px 0 0',
          padding: '8px 14px',
          fontWeight: 600,
          fontSize: 13,
          color: '#614700',
        }}
      >
        {t(titleKey)}
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
        {/* Header row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1.2fr 1.2fr 2fr',
            gap: 0,
            background: '#fafafa',
            borderBottom: '1px solid #f0f0f0',
            padding: '6px 14px',
          }}
        >
          <Text style={{ fontSize: 11, color: '#595959', fontWeight: 600 }}>{t('boss_dashboard.production.header_block')}</Text>
          <Text style={{ fontSize: 11, color: '#595959', fontWeight: 600, textAlign: 'right' }}>{t('boss_dashboard.production.header_planned')}</Text>
          <Text style={{ fontSize: 11, color: '#595959', fontWeight: 600, textAlign: 'right' }}>{t('boss_dashboard.production.header_actual')}</Text>
          <Text style={{ fontSize: 11, color: '#595959', fontWeight: 600, paddingLeft: 12 }}>{t('boss_dashboard.production.header_graph')}</Text>
        </div>

        {/* Data rows */}
        {rows.map((row) => (
          <div
            key={row.block_code}
            onClick={() => onRowClick(row.block_code)}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.2fr 1.2fr 2fr',
              gap: 0,
              padding: '6px 14px',
              borderBottom: '1px solid #f5f5f5',
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#fafafa'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <Text style={{ fontSize: 12 }}>{row.block_name || row.block_code}</Text>
            <Text style={{ fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
              {row[planKey].toLocaleString()}
            </Text>
            <Text style={{ fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
              {row[actualKey].toLocaleString()}
            </Text>
            <div style={{ paddingLeft: 12 }}>
              <ProgressBar
                monthlyPct={row.monthly_pct}
                scopePct={row[pctKey]}
                scope={scope}
              />
            </div>
          </div>
        ))}

        {/* Total row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1.2fr 1.2fr 2fr',
            gap: 0,
            padding: '7px 14px',
            background: '#f5f5f5',
            borderTop: '1px solid #e8e8e8',
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('boss_dashboard.production.total_row')}</Text>
          <Text style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', fontFamily: 'monospace' }}>
            {totalPlan.toLocaleString()}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', fontFamily: 'monospace' }}>
            {totalActual.toLocaleString()}
          </Text>
          <div style={{ paddingLeft: 12 }}>
            <ProgressBar monthlyPct={totalPct} scopePct={totalPct} scope={scope} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface IProgressBarProps {
  monthlyPct: number;
  scopePct: number;
  scope: 'daily' | 'seasonal';
}

function ProgressBar({ monthlyPct, scopePct, scope: _scope }: IProgressBarProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Blue = monthly */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, background: '#e8e8e8', borderRadius: 2, height: 5 }}>
          <div
            style={{
              width: `${Math.min(monthlyPct, 100)}%`,
              background: '#1677ff',
              height: 5,
              borderRadius: 2,
            }}
          />
        </div>
        <Text style={{ fontSize: 10, color: '#1677ff', minWidth: 28, textAlign: 'right' }}>
          {monthlyPct.toFixed(0)}%
        </Text>
      </div>
      {/* Red = daily/seasonal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, background: '#e8e8e8', borderRadius: 2, height: 5 }}>
          <div
            style={{
              width: `${Math.min(scopePct, 100)}%`,
              background: '#ff4d4f',
              height: 5,
              borderRadius: 2,
            }}
          />
        </div>
        <Text style={{ fontSize: 10, color: '#ff4d4f', minWidth: 28, textAlign: 'right' }}>
          {scopePct.toFixed(0)}%
        </Text>
      </div>
    </div>
  );
}

interface IProductionResultsProps {
  period: BossPeriod;
}

export function ProductionResults({ period }: IProductionResultsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: dailyData, isLoading: dailyLoading } = useBossProduction(period, 'daily');
  const { data: seasonalData, isLoading: seasonalLoading } = useBossProduction(period, 'seasonal');

  const handleRowClick = (blockCode: string) => {
    navigate(`/export/plan?block=${blockCode}`);
  };

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.production_daily')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 16 }}
    >
      {dailyLoading || seasonalLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          <ProductionTable
            rows={dailyData?.rows ?? []}
            scope="daily"
            titleKey="boss_dashboard.section.production_daily"
            onRowClick={handleRowClick}
          />
          <ProductionTable
            rows={seasonalData?.rows ?? []}
            scope="seasonal"
            titleKey="boss_dashboard.section.production_seasonal"
            onRowClick={handleRowClick}
          />
        </>
      )}
    </Card>
  );
}
