import { Badge, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IWeeklyFlow, IWeeklyFlowFirm } from '@/types';

const { Text } = Typography;

interface IProps {
  data: IWeeklyFlow[];
}

function fmtKg(val: number): string {
  return Number(val).toLocaleString();
}

export function QuotaWeeklyFlow({ data }: IProps) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#8c8c8c' }}>
        {t('quota_dashboard.no_data')}
      </div>
    );
  }

  const firmColumns = [
    {
      title: t('quota_dashboard.firm'),
      dataIndex: 'firm_name',
      key: 'firm_name',
      render: (name: string, row: IWeeklyFlowFirm) => (
        <span style={{ color: row.sold_kg > 0 && row.got_kg === 0 ? '#ff4d4f' : undefined }}>
          {name}
        </span>
      ),
    },
    {
      title: t('quota_dashboard.sold'),
      dataIndex: 'sold_kg',
      key: 'sold_kg',
      align: 'right' as const,
      render: (v: number) => fmtKg(v),
    },
    {
      title: t('quota_dashboard.expected'),
      dataIndex: 'expected_kg',
      key: 'expected_kg',
      align: 'right' as const,
      render: (v: number) => fmtKg(v),
    },
    {
      title: t('quota_dashboard.got'),
      dataIndex: 'got_kg',
      key: 'got_kg',
      align: 'right' as const,
      render: (v: number, row: IWeeklyFlowFirm) => (
        <span style={{ color: row.sold_kg > 0 && v === 0 ? '#ff4d4f' : undefined }}>
          {fmtKg(v)}
        </span>
      ),
    },
    {
      title: t('quota_dashboard.difference'),
      dataIndex: 'diff_kg',
      key: 'diff_kg',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v < 0 ? '#ff4d4f' : v > 0 ? '#52c41a' : undefined }}>
          {v >= 0 ? '+' : ''}{fmtKg(v)}
        </span>
      ),
    },
  ];

  const columns = [
    {
      title: t('quota_dashboard.week'),
      key: 'week',
      width: 90,
      render: (_: unknown, flow: IWeeklyFlow) => (
        <Text strong>W{flow.week}</Text>
      ),
    },
    {
      title: t('quota_dashboard.date_range'),
      key: 'date_range',
      width: 180,
      render: (_: unknown, flow: IWeeklyFlow) => (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {flow.date_from} — {flow.date_to}
        </Text>
      ),
    },
    {
      title: t('quota_dashboard.kpi_sales'),
      key: 'sales_kg',
      align: 'right' as const,
      width: 120,
      render: (_: unknown, flow: IWeeklyFlow) => fmtKg(flow.sales_kg),
    },
    {
      title: t('quota_dashboard.expected'),
      key: 'expected_kg',
      align: 'right' as const,
      width: 120,
      render: (_: unknown, flow: IWeeklyFlow) => fmtKg(flow.expected_kg),
    },
    {
      title: t('quota_dashboard.issued'),
      key: 'issued_kg',
      align: 'right' as const,
      width: 120,
      render: (_: unknown, flow: IWeeklyFlow) => (
        <Text style={{ color: '#1677ff', fontWeight: 600 }}>{fmtKg(flow.issued_kg)}</Text>
      ),
    },
    {
      title: t('quota_dashboard.coverage'),
      key: 'coverage_pct',
      align: 'right' as const,
      width: 100,
      render: (_: unknown, flow: IWeeklyFlow) => {
        const pct = Number(flow.coverage_pct).toFixed(1);
        return (
          <Text style={{ fontWeight: 600, color: flow.coverage_pct < 80 ? '#ff4d4f' : '#52c41a' }}>
            {pct}%
          </Text>
        );
      },
    },
    {
      title: t('quota_dashboard.gap'),
      key: 'gap_kg',
      align: 'right' as const,
      width: 140,
      render: (_: unknown, flow: IWeeklyFlow) => {
        const gapColor = flow.gap_kg < 0 ? '#ff4d4f' : '#52c41a';
        const gapSign = flow.gap_kg >= 0 ? '+' : '';
        return (
          <Badge
            count={`${gapSign}${fmtKg(flow.gap_kg)} kg`}
            style={{
              background: gapColor,
              fontSize: 12,
              height: 22,
              lineHeight: '22px',
              padding: '0 8px',
              borderRadius: 11,
            }}
          />
        );
      },
    },
  ];

  return (
    <Table<IWeeklyFlow>
      dataSource={data}
      columns={columns}
      rowKey={(row) => `${row.year}-${row.week}`}
      size="small"
      pagination={false}
      expandable={{
        expandedRowRender: (flow) => (
          <div style={{ padding: '8px 0' }}>
            {flow.issuances.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 12, color: '#8c8c8c' }}>
                  {t('quota_dashboard.matched_issuances')}:{' '}
                </Text>
                {flow.issuances.map((iss, idx) => (
                  <Text key={idx} style={{ fontSize: 12, marginRight: 8 }}>
                    {iss.issue_date} — {fmtKg(iss.total_kg)} kg
                  </Text>
                ))}
              </div>
            )}
            {flow.firms.length > 0 && (
              <Table<IWeeklyFlowFirm>
                dataSource={flow.firms}
                columns={firmColumns}
                rowKey="firm_name"
                size="small"
                pagination={false}
                rowClassName={(row) =>
                  row.sold_kg > 0 && row.got_kg === 0 ? 'quota-row-missing' : ''
                }
                onRow={(row) => ({
                  style: row.sold_kg > 0 && row.got_kg === 0 ? { background: '#fff1f0' } : undefined,
                })}
              />
            )}
          </div>
        ),
        rowExpandable: (flow) => flow.firms.length > 0 || flow.issuances.length > 0,
      }}
    />
  );
}
