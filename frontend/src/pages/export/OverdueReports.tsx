import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Row,
  Col,
  Statistic,
  Card,
  Tag,
  Alert,
  Segmented,
  Typography,
} from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useOverdueShipments } from '@/hooks/useOverdueShipments';
import { StatusTag } from '@/components/StatusTag';
import type { IOverdueShipment } from '@/types';

const THRESHOLD_OPTIONS = [5, 7, 10, 14] as const;
type ThresholdValue = (typeof THRESHOLD_OPTIONS)[number];

function daysOverdueColor(days: number): string {
  if (days > 14) return '#ff4d4f';
  if (days >= 10) return '#fa8c16';
  return '#52c41a';
}

export default function OverdueReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [threshold, setThreshold] = useState<ThresholdValue>(7);

  // ── Server data ────────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useOverdueShipments(threshold);

  // ── Derived ────────────────────────────────────────────────────────────────
  const shipments = data?.results ?? [];

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

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleRowClick(record: IOverdueShipment) {
    navigate(`/shipments/${record.id}`);
  }

  function handleThresholdChange(value: string | number) {
    setThreshold(value as ThresholdValue);
  }

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns: ProColumns<IOverdueShipment>[] = [
    {
      title: t('overdue.cargo_code'),
      dataIndex: 'cargo_code',
      width: 140,
      render: (_, record) => (
        <Typography.Link
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/shipments/${record.id}`);
          }}
        >
          {record.cargo_code}
        </Typography.Link>
      ),
    },
    {
      title: t('overdue.status'),
      dataIndex: 'status_display',
      width: 130,
      render: (_, record) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      title: t('overdue.country'),
      dataIndex: 'country_name',
      width: 120,
      responsive: ['md'],
      render: (_, record) => record.country_name ?? '—',
    },
    {
      title: t('overdue.customer'),
      dataIndex: 'customer_name',
      width: 160,
      responsive: ['md'],
      render: (_, record) => record.customer_name ?? '—',
    },
    {
      title: t('overdue.weight_net'),
      dataIndex: 'weight_net',
      width: 110,
      align: 'right',
      responsive: ['lg'],
      render: (_, record) =>
        record.weight_net != null
          ? record.weight_net.toLocaleString()
          : '—',
    },
    {
      title: t('overdue.days_overdue'),
      dataIndex: 'days_overdue',
      width: 130,
      sorter: (a, b) => a.days_overdue - b.days_overdue,
      defaultSortOrder: 'descend',
      render: (_, record) => (
        <Typography.Text strong style={{ color: daysOverdueColor(record.days_overdue) }}>
          {t('overdue.days', { count: record.days_overdue })}
        </Typography.Text>
      ),
    },
    {
      title: t('overdue.has_report'),
      dataIndex: 'has_sales_report',
      width: 90,
      align: 'center',
      render: (_, record) =>
        record.has_sales_report ? (
          <Tag color="success">{t('overdue.yes')}</Tag>
        ) : (
          <Tag color="error">{t('overdue.no')}</Tag>
        ),
    },
  ];

  // ── Early returns ──────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Alert
        type="error"
        message={t('overdue.error_load')}
        style={{ margin: 24 }}
      />
    );
  }

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 4px' }}>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <WarningOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('overdue.title')}
        </Typography.Title>
      </div>

      {/* Summary cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small" bordered>
            <Statistic
              title={t('overdue.total_overdue')}
              value={totalOverdue}
              valueStyle={{ color: totalOverdue > 0 ? '#ff4d4f' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" bordered>
            <Statistic
              title={t('overdue.avg_days')}
              value={avgDays}
              suffix={t('overdue.days_unit')}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" bordered>
            <Statistic
              title={t('overdue.critical')}
              value={criticalCount}
              valueStyle={{ color: criticalCount > 0 ? '#ff4d4f' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      {/* Threshold selector */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Typography.Text type="secondary">{t('overdue.threshold')}:</Typography.Text>
        <Segmented
          value={threshold}
          options={THRESHOLD_OPTIONS.map((d) => ({
            label: t('overdue.days', { count: d }),
            value: d,
          }))}
          onChange={handleThresholdChange}
        />
      </div>

      {/* Table */}
      <ProTable<IOverdueShipment>
        rowKey="id"
        columns={columns}
        dataSource={shipments}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 600 }}
        onRow={(record) => ({
          onClick: () => handleRowClick(record),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: t('overdue.empty') }}
        cardBordered
      />
    </div>
  );
}
