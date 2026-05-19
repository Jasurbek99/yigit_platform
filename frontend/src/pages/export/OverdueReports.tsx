import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Radio, Row, Col, Space, Typography } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useOverdueShipments } from '@/hooks/useOverdueShipments';
import { StatusTag } from '@/components/StatusTag';
import type { IOverdueShipment } from '@/types';

const { Text, Link } = Typography;

const THRESHOLD_OPTIONS = [5, 7, 10, 14] as const;
type ThresholdValue = (typeof THRESHOLD_OPTIONS)[number];

function daysOverdueColor(days: number): string {
  if (days > 14) return '#ff4d4f';
  if (days >= 10) return '#fa8c16';
  return '#52c41a';
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card size="small">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{title}</Text>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </Card>
  );
}

export default function OverdueReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [threshold, setThreshold] = useState<ThresholdValue>(7);

  const { data, isLoading, isError } = useOverdueShipments(threshold);

  const shipments = useMemo(() => data?.results ?? [], [data?.results]);

  const totalOverdue = data?.count ?? 0;

  const avgDays = useMemo(() => {
    if (shipments.length === 0) return 0;
    const sum = shipments.reduce((acc, s) => acc + s.days_overdue, 0);
    return Math.round(sum / shipments.length);
  }, [shipments]);

  const criticalCount = useMemo(
    () => shipments.filter((s) => s.days_overdue > 14).length,
    [shipments],
  );

  const columns: ProColumns<IOverdueShipment>[] = [
    {
      title: t('overdue.cargo_code'),
      dataIndex: 'cargo_code',
      width: 140,
      search: false,
      sorter: (a, b) => a.cargo_code.localeCompare(b.cargo_code),
      render: (_, record) => (
        <Link
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/shipments/${record.id}`);
          }}
        >
          {record.cargo_code}
        </Link>
      ),
    },
    {
      title: t('overdue.status'),
      dataIndex: 'status_display',
      width: 130,
      search: false,
      sorter: (a, b) => a.status_display.localeCompare(b.status_display),
      render: (_, record) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      title: t('overdue.country'),
      dataIndex: 'country_name',
      width: 120,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.country_name ?? '').localeCompare(b.country_name ?? ''),
      render: (_, record) => record.country_name ?? '—',
    },
    {
      title: t('overdue.customer'),
      dataIndex: 'customer_name',
      width: 160,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''),
      render: (_, record) => record.customer_name ?? '—',
    },
    {
      title: t('overdue.weight_net'),
      dataIndex: 'weight_net',
      width: 110,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.weight_net ?? 0) - (b.weight_net ?? 0),
      render: (_, record) =>
        record.weight_net != null ? record.weight_net.toLocaleString() : '—',
    },
    {
      title: t('overdue.days_overdue'),
      dataIndex: 'days_overdue',
      width: 130,
      search: false,
      sorter: (a, b) => a.days_overdue - b.days_overdue,
      defaultSortOrder: 'descend',
      render: (_, record) => (
        <span style={{ color: daysOverdueColor(record.days_overdue), fontWeight: 600 }}>
          {t('overdue.days', { count: record.days_overdue })}
        </span>
      ),
    },
    {
      title: t('overdue.has_report'),
      dataIndex: 'has_sales_report',
      width: 90,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => Number(a.has_sales_report) - Number(b.has_sales_report),
      render: (_, record) =>
        record.has_sales_report ? (
          <span style={{ color: '#52c41a', fontWeight: 600, fontSize: 13 }}>{t('overdue.yes')}</span>
        ) : (
          <span style={{ color: '#ff4d4f', fontWeight: 600, fontSize: 13 }}>{t('overdue.no')}</span>
        ),
    },
  ];

  if (isError) {
    return (
      <Alert type="error" message={t('overdue.error_load')} showIcon style={{ margin: 16 }} />
    );
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconAlertTriangle style={{ color: '#ff4d4f', fontSize: 18 }} />
            {t('overdue.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('overdue.subtitle')}
          </div>
        </div>
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <StatCard
            title={t('overdue.total_overdue')}
            value={totalOverdue}
            color={totalOverdue > 0 ? '#ff4d4f' : undefined}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            title={t('overdue.avg_days')}
            value={`${avgDays} ${t('overdue.days_unit')}`}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            title={t('overdue.critical')}
            value={criticalCount}
            color={criticalCount > 0 ? '#ff4d4f' : undefined}
          />
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }} align="center">
        <Text type="secondary">{t('overdue.threshold')}:</Text>
        <Radio.Group
          value={threshold}
          onChange={(e) => setThreshold(e.target.value as ThresholdValue)}
          optionType="button"
          buttonStyle="solid"
          options={THRESHOLD_OPTIONS.map((d) => ({
            label: t('overdue.days', { count: d }),
            value: d,
          }))}
        />
      </Space>

      <ProTable<IOverdueShipment>
        rowKey="id"
        dataSource={shipments}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        onRow={(record) => ({
          onClick: () => navigate(`/shipments/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: t('overdue.empty') }}
      />
    </div>
  );
}
