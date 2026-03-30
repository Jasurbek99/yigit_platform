import { Typography, Progress, Table, Tag, Skeleton, Alert, Statistic, Row, Col, Card } from 'antd';
import { useTranslation } from 'react-i18next';
import { useQuotaDashboard } from '@/hooks/usePlanning';
import type { IQuotaDashboardItem } from '@/types';
import type { ColumnsType } from 'antd/es/table';

function pctColor(pct: number): string {
  if (pct >= 95) return '#ff4d4f';
  if (pct >= 80) return '#fa8c16';
  return '#52c41a';
}

function pctStatus(pct: number): 'success' | 'normal' | 'exception' {
  if (pct >= 95) return 'exception';
  if (pct >= 80) return 'normal';
  return 'success';
}

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${Number(val).toLocaleString()} kg`;
}

export default function QuotaDashboard() {
  const { t } = useTranslation();
  const { data: quotas, isLoading, isError } = useQuotaDashboard();

  const totalGranted = quotas?.reduce((s, q) => s + Number(q.granted_kg), 0) ?? 0;
  const totalUsed = quotas?.reduce((s, q) => s + Number(q.used_kg), 0) ?? 0;
  const overLimit = quotas?.filter((q) => q.used_pct >= 95).length ?? 0;
  const warning = quotas?.filter((q) => q.used_pct >= 80 && q.used_pct < 95).length ?? 0;

  const columns: ColumnsType<IQuotaDashboardItem> = [
    {
      title: t('quota.firm'),
      dataIndex: 'export_firm_name',
      fixed: 'left',
      width: 180,
      render: (name: string | null) => name ?? '—',
    },
    {
      title: t('quota.granted'),
      dataIndex: 'granted_kg',
      width: 130,
      align: 'right',
      render: fmtKg,
    },
    {
      title: t('quota.used'),
      dataIndex: 'used_kg',
      width: 130,
      align: 'right',
      render: fmtKg,
    },
    {
      title: t('quota.remaining'),
      dataIndex: 'remaining_kg',
      width: 130,
      align: 'right',
      render: (val: number) => (
        <span style={{ color: val <= 0 ? '#ff4d4f' : val < 50000 ? '#fa8c16' : '#52c41a' }}>
          {fmtKg(val)}
        </span>
      ),
    },
    {
      title: t('quota.used_pct'),
      dataIndex: 'used_pct',
      width: 200,
      render: (pct: number) => (
        <Progress
          percent={Math.min(pct, 100)}
          size="small"
          strokeColor={pctColor(pct)}
          status={pctStatus(pct)}
          format={() => `${pct}%`}
        />
      ),
    },
    {
      title: t('quota.alerts'),
      width: 120,
      render: (_: unknown, row: IQuotaDashboardItem) => {
        if (row.used_pct >= 95) return <Tag color="error">≥95%</Tag>;
        if (row.used_pct >= 90) return <Tag color="warning">≥90%</Tag>;
        if (row.used_pct >= 80) return <Tag color="orange">≥80%</Tag>;
        return <Tag color="success">OK</Tag>;
      },
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>{t('quota.title')}</Typography.Title>

      {isError && <Alert type="error" message={t('quota.error_load')} style={{ marginBottom: 16 }} />}

      {/* Summary cards */}
      <Row gutter={[16, 12]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('quota.total_granted')} value={totalGranted} suffix="kg" formatter={(v) => Number(v).toLocaleString()} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('quota.total_used')} value={totalUsed} suffix="kg" formatter={(v) => Number(v).toLocaleString()} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('quota.warning_firms')} value={warning} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('quota.critical_firms')} value={overLimit} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
      </Row>

      {isLoading ? (
        <Skeleton active />
      ) : (
        <Table<IQuotaDashboardItem>
          rowKey="id"
          dataSource={quotas ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: 760 }}
          size="small"
          rowClassName={(row) => row.used_pct >= 95 ? 'ant-table-row-danger' : ''}
        />
      )}
    </div>
  );
}
