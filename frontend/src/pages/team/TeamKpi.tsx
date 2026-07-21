// TeamKpi — public per-user task leaderboard (Bitrix-style).
//
// Visibility (locked decision): every authenticated user sees everyone's
// numbers, mirroring the Worklog page's radical-transparency rule. Ranks by
// tasks completed in the selected period; overdue-now is current-state and
// does not follow the period selector.

import { useMemo, useState } from 'react';
import { Alert, Card, Segmented, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTeamKpi } from '@/hooks/useTeamKpi';
import type { ITeamKpiRow, TeamKpiPeriod } from '@/types/teamKpi';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;
const PERIODS: TeamKpiPeriod[] = ['today', 'week', 'month', 'season'];

function formatHm(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function TeamKpi() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const period: TeamKpiPeriod =
    raw && (PERIODS as string[]).includes(raw) ? (raw as TeamKpiPeriod) : 'week';

  const query = useTeamKpi(period);
  const [page, setPage] = useState({ current: 1, pageSize: 25 });

  const columns: ColumnsType<ITeamKpiRow> = useMemo(() => [
    {
      title: '#',
      key: 'rank',
      width: 56,
      render: (_v, _row, idx) => (
        <Text type="secondary">{(page.current - 1) * page.pageSize + idx + 1}</Text>
      ),
    },
    {
      title: t('team_kpi.col_user'),
      dataIndex: 'user_name',
      key: 'user_name',
      sorter: (a, b) => a.user_name.localeCompare(b.user_name),
    },
    {
      title: t('team_kpi.col_role'),
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role: string) => (
        <Tag color="blue">{t(`roles.${role}`, { defaultValue: role })}</Tag>
      ),
      sorter: (a, b) => a.role.localeCompare(b.role),
    },
    {
      title: t('team_kpi.col_completed'),
      dataIndex: 'completed',
      key: 'completed',
      width: 120,
      align: 'right' as const,
      render: (n: number) => (
        <Text strong={n > 0} type={n === 0 ? 'secondary' : undefined}
          style={{ fontSize: 16 }}>
          {n === 0 ? '—' : n}
        </Text>
      ),
      sorter: (a, b) => a.completed - b.completed,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: t('team_kpi.col_on_time'),
      dataIndex: 'on_time_rate',
      key: 'on_time_rate',
      width: 110,
      align: 'right' as const,
      render: (rate: number | null) => {
        if (rate == null) return <Text type="secondary">—</Text>;
        const pct = Math.round(rate * 100);
        return <Text style={{ color: rate >= 0.8 ? COLORS.success : COLORS.orange }}>{pct}%</Text>;
      },
      sorter: (a, b) => (a.on_time_rate ?? -1) - (b.on_time_rate ?? -1),
    },
    {
      title: t('team_kpi.col_overdue'),
      dataIndex: 'overdue_now',
      key: 'overdue_now',
      width: 120,
      align: 'right' as const,
      render: (n: number) => (
        <Text style={{ color: n > 0 ? COLORS.orange : undefined }}
          type={n === 0 ? 'secondary' : undefined}>
          {n === 0 ? '—' : n}
        </Text>
      ),
      sorter: (a, b) => a.overdue_now - b.overdue_now,
    },
    {
      title: t('team_kpi.col_active'),
      dataIndex: 'active_seconds',
      key: 'active_seconds',
      width: 120,
      align: 'right' as const,
      render: (sec: number) => (
        <Text type={sec === 0 ? 'secondary' : undefined}>
          {sec === 0 ? '—' : formatHm(sec)}
        </Text>
      ),
      sorter: (a, b) => a.active_seconds - b.active_seconds,
    },
  ], [t, page]);

  return (
    <div style={{ padding: '0 4px' }}>
      <Title level={3} style={{ marginBottom: 4 }}>{t('team_kpi.title')}</Title>
      <Text type="secondary">{t('team_kpi.subtitle')}</Text>

      {query.isError && (
        <Alert
          type="error"
          message={t('team_kpi.load_error')}
          showIcon
          style={{ marginTop: 16 }}
        />
      )}

      <Card size="small" style={{ marginTop: 16 }}
        title={
          <Segmented<TeamKpiPeriod>
            size="small"
            value={period}
            onChange={(v) => setParams({ period: v })}
            options={PERIODS.map((p) => ({ value: p, label: t(`team_kpi.period_${p}`) }))}
          />
        }
      >
        <Table<ITeamKpiRow>
          size="small"
          loading={query.isLoading}
          dataSource={query.data?.results ?? []}
          columns={columns}
          rowKey="user_id"
          pagination={{
            current: page.current,
            pageSize: page.pageSize,
            showSizeChanger: false,
            hideOnSinglePage: true,
          }}
          onChange={(pagination) =>
            setPage({ current: pagination.current ?? 1, pageSize: pagination.pageSize ?? 25 })
          }
          locale={{ emptyText: t('team_kpi.no_data') }}
        />
      </Card>
    </div>
  );
}
