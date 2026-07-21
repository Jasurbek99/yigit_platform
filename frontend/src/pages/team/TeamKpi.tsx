// TeamKpi — public per-user task leaderboard (Bitrix-style visual).
// Ranking bar chart + per-user KPI cards with on-time meter and 14-day trend.
// Overdue-now is current-state and does not follow the period selector.

import { Alert, Card, Segmented, Skeleton, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTeamKpi } from '@/hooks/useTeamKpi';
import type { TeamKpiPeriod } from '@/types/teamKpi';
import { TeamRankingChart } from '@/components/team/TeamRankingChart';
import { TeamKpiCard } from '@/components/team/TeamKpiCard';

const { Title, Text } = Typography;
const PERIODS: TeamKpiPeriod[] = ['today', 'week', 'month', 'season'];

export default function TeamKpi() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const period: TeamKpiPeriod =
    raw && (PERIODS as string[]).includes(raw) ? (raw as TeamKpiPeriod) : 'week';

  const query = useTeamKpi(period);
  const rows = query.data?.results ?? [];

  return (
    <div style={{ padding: '0 4px' }}>
      <Title level={3} style={{ marginBottom: 4 }}>{t('team_kpi.title')}</Title>
      <Text type="secondary">{t('team_kpi.subtitle')}</Text>

      {query.isError && (
        <Alert type="error" message={t('team_kpi.load_error')} showIcon style={{ marginTop: 16 }} />
      )}

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <Segmented<TeamKpiPeriod>
          value={period}
          onChange={(v) => setParams({ period: v })}
          options={PERIODS.map((p) => ({ value: p, label: t(`team_kpi.period_${p}`) }))}
        />
      </div>

      {query.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : rows.length === 0 ? (
        <Card size="small"><Text type="secondary">{t('team_kpi.no_users')}</Text></Card>
      ) : (
        <>
          <Card size="small" title={t('team_kpi.ranking_title')} style={{ marginBottom: 16 }}>
            <TeamRankingChart rows={rows} />
          </Card>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 12,
          }}>
            {rows.map((row, idx) => (
              <TeamKpiCard key={row.user_id} row={row} rank={idx + 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
