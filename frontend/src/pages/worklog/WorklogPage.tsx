// WorklogPage — the team's daily work-time board.
//
// Visibility rule (locked decision): every authenticated user can read every
// other user's hours. No admin gate. Reads the existing `/core/worklog/team/`
// endpoint and renders a sortable Ant table; the same page also surfaces the
// signed-in user's last-7-day breakdown via a small embedded section.

import { useMemo, useState } from 'react';
import { Card, DatePicker, Table, Tag, Typography, Space, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useMyWorklog, useTeamWorklog } from '@/hooks/useWorklog';
import type { IWorklogTeamRow } from '@/types/worklog';

const { Title, Text } = Typography;

function formatHm(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function WorklogPage() {
  const { t } = useTranslation();
  const [day, setDay] = useState<Dayjs>(dayjs());

  const teamQuery = useTeamWorklog(day.format('YYYY-MM-DD'));
  const myQuery = useMyWorklog();

  const columns: ColumnsType<IWorklogTeamRow> = useMemo(() => [
    {
      title: '#',
      key: 'rank',
      width: 60,
      render: (_v, _row, idx) => <Text type="secondary">{idx + 1}</Text>,
    },
    {
      title: t('worklog.col_user'),
      dataIndex: 'user_name',
      key: 'user_name',
      sorter: (a, b) => a.user_name.localeCompare(b.user_name),
    },
    {
      title: t('worklog.col_role'),
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role: string) => (
        <Tag color="blue">{t(`roles.${role}`, { defaultValue: role })}</Tag>
      ),
      sorter: (a, b) => a.role.localeCompare(b.role),
    },
    {
      title: t('worklog.col_active'),
      dataIndex: 'active_seconds',
      key: 'active_seconds',
      width: 140,
      align: 'right' as const,
      render: (sec: number) => (
        <Text strong={sec > 0} type={sec === 0 ? 'secondary' : undefined}>
          {sec === 0 ? '—' : formatHm(sec)}
        </Text>
      ),
      sorter: (a, b) => a.active_seconds - b.active_seconds,
      defaultSortOrder: 'descend' as const,
    },
  ], [t]);

  return (
    <div style={{ padding: '0 4px' }}>
      <Title level={3} style={{ marginBottom: 4 }}>{t('worklog.title')}</Title>
      <Text type="secondary">{t('worklog.subtitle')}</Text>

      {/* Personal last-7-days */}
      <Card
        size="small"
        style={{ marginTop: 16, marginBottom: 16 }}
        title={t('worklog.my_week_title')}
      >
        {myQuery.isLoading || !myQuery.data ? (
          <Skeleton paragraph={{ rows: 2 }} active />
        ) : (
          <Space size="large" wrap>
            <span>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('worklog.today_label')}: </Text>
              <Text strong style={{ fontSize: 16 }}>{formatHm(myQuery.data.today_active_seconds)}</Text>
            </span>
            <span>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('worklog.range_label')}: </Text>
              <Text strong style={{ fontSize: 16 }}>{formatHm(myQuery.data.total_active_seconds)}</Text>
            </span>
            <span>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('worklog.days_with_activity')}: </Text>
              <Text strong style={{ fontSize: 16 }}>{myQuery.data.results.length}</Text>
            </span>
          </Space>
        )}
      </Card>

      {/* Team day picker + table */}
      <Card
        size="small"
        title={
          <Space>
            <span>{t('worklog.team_table_title')}</span>
            <DatePicker
              size="small"
              allowClear={false}
              value={day}
              onChange={(d) => d && setDay(d)}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            />
          </Space>
        }
      >
        <Table<IWorklogTeamRow>
          size="small"
          loading={teamQuery.isLoading}
          dataSource={teamQuery.data?.results ?? []}
          columns={columns}
          rowKey="user_id"
          pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: t('worklog.no_data') }}
        />
      </Card>
    </div>
  );
}
