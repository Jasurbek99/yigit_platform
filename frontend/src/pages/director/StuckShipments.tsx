import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, Tag, Typography, Empty, Alert, Space } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useShipments } from '@/hooks/useShipments';
import { StatusTag } from '@/components/StatusTag';
import type { IShipmentListItem } from '@/types';

const { Title, Text } = Typography;

/** Color-coded by days_stuck per ADR-0005 §4.7 (master plan). */
function stuckColor(days: number): { tag: 'warning' | 'orange' | 'error'; bg: string } {
  if (days >= 15) return { tag: 'error', bg: '#fff2f0' };
  if (days >= 8) return { tag: 'orange', bg: '#fff7e6' };
  return { tag: 'warning', bg: '#fffbe6' };
}

function daysSince(iso: string): number {
  return dayjs().startOf('day').diff(dayjs(iso).startOf('day'), 'day');
}

/**
 * StuckShipments — director / admin / boss only.
 *
 * Shows operational shipments (is_archived=False, phase != COMPLETE) that
 * haven't been touched in ≥4 days, oldest first. Read-only view: each row
 * links to the detail page so the user can intervene manually.
 *
 * Notification escalation (Phase 4b — separate commit) will pull from the
 * same backend filter. This page is the human-readable surface; the
 * notification cron is the headless one.
 */
export default function StuckShipments() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useShipments({
    page: 1,
    page_size: 100,
    stuck: true,
  });

  const rows: IShipmentListItem[] = useMemo(() => data?.results ?? [], [data?.results]);

  // Bucket counts for the summary header — useful at a glance.
  const buckets = useMemo(() => {
    let red = 0;
    let orange = 0;
    let yellow = 0;
    rows.forEach((r) => {
      const d = daysSince(r.updated_at);
      if (d >= 15) red++;
      else if (d >= 8) orange++;
      else yellow++;
    });
    return { red, orange, yellow, total: rows.length };
  }, [rows]);

  // ProTable column render signature: (dom, record, index, action, schema) — the
  // first arg is the rendered cell value as ReactNode, not the typed scalar. We
  // only need `record` here, so the first arg is a typed-as-unknown placeholder.
  const columns: ProColumns<IShipmentListItem>[] = [
    {
      title: t('stuck.col_cargo_code'),
      dataIndex: 'cargo_code',
      key: 'cargo_code',
      width: 140,
      render: (_dom, record) => (
        <Link to={`/shipments/${record.id}`} style={{ fontFamily: 'monospace' }}>
          {record.cargo_code}
        </Link>
      ),
    },
    {
      title: t('stuck.col_status'),
      key: 'status',
      width: 160,
      render: (_dom, record) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      title: t('stuck.col_days_stuck'),
      key: 'days_stuck',
      width: 120,
      sorter: (a, b) => daysSince(a.updated_at) - daysSince(b.updated_at),
      render: (_dom, record) => {
        const days = daysSince(record.updated_at);
        const { tag } = stuckColor(days);
        return (
          <Tag color={tag} style={{ fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'center' }}>
            {t('stuck.days', { count: days })}
          </Tag>
        );
      },
    },
    {
      title: t('stuck.col_country'),
      dataIndex: 'country_name',
      key: 'country_name',
      width: 140,
      render: (_dom, record) => record.country_name ?? '—',
    },
    {
      title: t('stuck.col_customer'),
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 180,
      render: (_dom, record) => record.customer_name ?? '—',
    },
    {
      title: t('stuck.col_last_touched'),
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (_dom, record) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {dayjs(record.updated_at).format('DD.MM.YYYY HH:mm')}
        </Text>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        {t('stuck.page_title')}
      </Title>
      <Text type="secondary">{t('stuck.page_subtitle')}</Text>

      <Card size="small" style={{ marginTop: 12, marginBottom: 16 }}>
        <Space size="middle">
          <Tag color="error">{t('stuck.bucket_red', { count: buckets.red })}</Tag>
          <Tag color="orange">{t('stuck.bucket_orange', { count: buckets.orange })}</Tag>
          <Tag color="warning">{t('stuck.bucket_yellow', { count: buckets.yellow })}</Tag>
          <Text type="secondary">{t('stuck.total', { count: buckets.total })}</Text>
        </Space>
      </Card>

      {isError && (
        <Alert
          type="error"
          message={t('stuck.load_error')}
          description={(error as Error)?.message ?? ''}
          style={{ marginBottom: 16 }}
        />
      )}

      <ProTable<IShipmentListItem>
        rowKey="id"
        dataSource={rows}
        loading={isLoading}
        columns={columns}
        search={false}
        options={false}
        pagination={false}
        size="small"
        rowClassName={(record) => {
          const days = daysSince(record.updated_at);
          if (days >= 15) return 'stuck-row-red';
          if (days >= 8) return 'stuck-row-orange';
          return 'stuck-row-yellow';
        }}
        locale={{ emptyText: <Empty description={t('stuck.empty')} /> }}
      />

      <style>{`
        .stuck-row-red    > td { background: #fff2f0 !important; }
        .stuck-row-orange > td { background: #fff7e6 !important; }
        .stuck-row-yellow > td { background: #fffbe6 !important; }
      `}</style>
    </div>
  );
}
