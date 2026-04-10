import { useState } from 'react';
import { Badge, Card, Col, Collapse, Row, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IWeeklyFlow, IWeeklyFlowFirm } from '@/types';

const { Text } = Typography;

interface IProps {
  data: IWeeklyFlow[];
}

interface IWeekCardProps {
  flow: IWeeklyFlow;
}

function WeekCard({ flow }: IWeekCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const gapColor = flow.gap_kg < 0 ? '#ff4d4f' : '#52c41a';
  const gapSign = flow.gap_kg >= 0 ? '+' : '';
  const coveragePct = Number(flow.coverage_pct).toFixed(1);

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
      render: (v: number) => Number(v).toLocaleString(),
    },
    {
      title: t('quota_dashboard.expected'),
      dataIndex: 'expected_kg',
      key: 'expected_kg',
      align: 'right' as const,
      render: (v: number) => Number(v).toLocaleString(),
    },
    {
      title: t('quota_dashboard.got'),
      dataIndex: 'got_kg',
      key: 'got_kg',
      align: 'right' as const,
      render: (v: number, row: IWeeklyFlowFirm) => (
        <span style={{ color: row.sold_kg > 0 && v === 0 ? '#ff4d4f' : undefined }}>
          {Number(v).toLocaleString()}
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
          {v >= 0 ? '+' : ''}{Number(v).toLocaleString()}
        </span>
      ),
    },
  ];

  const collapseItems = [
    {
      key: 'firms',
      label: (
        <span style={{ fontSize: 13 }}>
          {t('quota_dashboard.firm')} ({flow.firms.length})
        </span>
      ),
      children: (
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
      ),
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div>
          <Text strong style={{ fontSize: 14 }}>
            {t('quota_dashboard.week')} {flow.week}
          </Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            {flow.date_from} — {flow.date_to}
          </Text>
        </div>
        <Badge
          count={`${gapSign}${Number(flow.gap_kg).toLocaleString()} kg`}
          style={{
            background: gapColor,
            fontSize: 12,
            height: 22,
            lineHeight: '22px',
            padding: '0 8px',
            borderRadius: 11,
          }}
        />
      </div>

      {/* KPI row */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>{t('quota_dashboard.kpi_sales')}</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {Number(flow.sales_kg).toLocaleString()}
          </div>
        </Col>
        <Col span={6}>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>{t('quota_dashboard.kpi_expected')}</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {Number(flow.expected_kg).toLocaleString()}
          </div>
        </Col>
        <Col span={6}>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>{t('quota_dashboard.kpi_issued')}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1677ff' }}>
            {Number(flow.issued_kg).toLocaleString()}
          </div>
        </Col>
        <Col span={6}>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>{t('quota_dashboard.coverage')}</div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: flow.coverage_pct < 80 ? '#ff4d4f' : '#52c41a',
            }}
          >
            {coveragePct}%
          </div>
        </Col>
      </Row>

      {/* Issuances */}
      {flow.issuances.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: '#8c8c8c' }}>
            {t('quota_dashboard.matched_issuances')}:{' '}
          </Text>
          {flow.issuances.map((iss, idx) => (
            <Text key={idx} style={{ fontSize: 12, marginRight: 8 }}>
              {iss.issue_date} — {Number(iss.total_kg).toLocaleString()} kg
            </Text>
          ))}
        </div>
      )}

      {/* Firm breakdown */}
      {flow.firms.length > 0 && (
        <Collapse
          ghost
          size="small"
          activeKey={expanded ? ['firms'] : []}
          onChange={(keys) => setExpanded(Array.isArray(keys) ? keys.includes('firms') : keys === 'firms')}
          items={collapseItems}
        />
      )}
    </Card>
  );
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

  return (
    <div>
      {data.map((flow) => (
        <WeekCard key={`${flow.year}-${flow.week}`} flow={flow} />
      ))}
    </div>
  );
}
