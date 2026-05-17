import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Tag, Tooltip, Typography } from 'antd';
import type { BossPeriod, IBossDebtFirm } from '@/hooks/useBossDashboard';
import { useBossDebt } from '@/hooks/useBossDashboard';

const { Text } = Typography;

function AgingBar({ aging }: { aging: IBossDebtFirm['aging'] }) {
  const { t } = useTranslation();
  const total = aging.fresh + aging.d30 + aging.d60 + aging.d90plus;
  if (total === 0) return null;

  const segments: { key: string; value: number; color: string; labelKey: string }[] = [
    { key: 'fresh', value: aging.fresh, color: '#52c41a', labelKey: 'boss_dashboard.aging.fresh' },
    { key: 'd30', value: aging.d30, color: '#faad14', labelKey: 'boss_dashboard.aging.d30' },
    { key: 'd60', value: aging.d60, color: '#fa8c16', labelKey: 'boss_dashboard.aging.d60' },
    { key: 'd90plus', value: aging.d90plus, color: '#ff4d4f', labelKey: 'boss_dashboard.aging.d90plus' },
  ];

  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
      {segments.map(({ key, value, color, labelKey }) => {
        const pct = (value / total) * 100;
        if (pct === 0) return null;
        return (
          <Tooltip key={key} title={`${t(labelKey)}: $${(value / 1000).toFixed(0)}k`}>
            <div style={{ width: `${pct}%`, background: color, minWidth: 2 }} />
          </Tooltip>
        );
      })}
    </div>
  );
}

interface IDebtBreakdownProps {
  period: BossPeriod;
}

export function DebtBreakdown({ period: _period }: IDebtBreakdownProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useBossDebt(_period);

  return (
    <Card
      size="small"
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.debt')}</Text>
          {(data?.is_placeholder ?? true) && (
            <Tag color="orange" style={{ fontSize: 10 }}>{t('common.demo_badge')}</Tag>
          )}
        </div>
      }
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 260, overflowY: 'auto' }}>
          {(data?.rows ?? []).map((firm, idx) => (
            <div key={firm.firm_name ?? idx}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: 500 }}>{firm.firm_name}</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>
                    ${(firm.total_usd / 1000).toFixed(0)}k
                  </Text>
                  <Tag
                    color={firm.avg_days > 60 ? 'red' : firm.avg_days > 30 ? 'orange' : 'green'}
                    style={{ fontSize: 10, margin: 0 }}
                  >
                    {firm.avg_days}d
                  </Tag>
                </div>
              </div>
              <AgingBar aging={firm.aging} />
            </div>
          ))}
          {(data?.rows ?? []).length === 0 && (
            <Text type="secondary" style={{ fontSize: 13 }}>{t('boss_dashboard.placeholder_p4')}</Text>
          )}
          {data?.total_usd !== undefined && data.total_usd > 0 && (
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('boss_dashboard.aging.fresh')}</Text>
              <Text style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>
                ${(data.total_usd / 1_000_000).toFixed(2)}M
              </Text>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
