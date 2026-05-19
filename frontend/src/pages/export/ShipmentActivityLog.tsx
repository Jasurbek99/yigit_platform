import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button, Card, Divider, Flex, Skeleton, Alert, Timeline, Tag, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { StatusTag } from '@/components/StatusTag';
import { CommentComposer } from '@/components/CommentComposer';
import type { IStatusLogEntry, IShipmentComment } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

function fmt(ts: string | null | undefined): string {
  if (!ts) return '—';
  return dayjs(ts).format('DD MMM HH:mm');
}

/**
 * Minimal activity log page for a shipment.
 * Shows the status change timeline and comment thread.
 * Route: /shipments/:id/activity
 */
export default function ShipmentActivityLog() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: shipment, isLoading, isError } = useShipmentDetail(id);

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (isError || !shipment) {
    return <Alert type="error" message={t('shipment_detail.error_load')} style={{ margin: 24 }} />;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 6 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
          <span style={{ fontSize: 18, fontWeight: 600, fontFamily: 'monospace' }}>
            {shipment.cargo_code}
          </span>
          <StatusTag statusDisplay={shipment.status_display} />
          <div style={{ marginLeft: 'auto' }}>
            <Link to={`/shipments/${shipment.id}`}>
              <Button type="link" style={{ paddingRight: 0 }}>
                {t('shipment.detail.back_to_detail')}
              </Button>
            </Link>
          </div>
        </Flex>
        <div style={{ paddingLeft: 44, fontSize: 13, color: COLORS.textSecondary }}>
          {t('shipment.detail.activity_link')}
        </div>
      </div>

      {/* Status history timeline */}
      <Card title={t('shipment_detail.tab_history', { count: shipment.status_log.length })} style={{ marginBottom: 24 }}>
        <Timeline
          items={shipment.status_log.map((entry: IStatusLogEntry) => ({
            children: (
              <div>
                <Flex gap={8} align="center" wrap="wrap">
                  <StatusTag statusDisplay={entry.status_display} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {fmt(entry.changed_at)} — {t('shipment_detail.history_by', { name: entry.changed_by_name })}
                  </Text>
                </Flex>
                {entry.comment && (
                  <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                    {entry.comment}
                  </Text>
                )}
              </div>
            ),
          }))}
        />
      </Card>

      {/* Comments */}
      <Card title={t('shipment_detail.tab_comments', { count: shipment.comments.length })}>
        {shipment.comments.length === 0 ? (
          <Text type="secondary">{t('shipment_detail.no_comments')}</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {shipment.comments.map((c: IShipmentComment) => (
              <div
                key={c.id}
                style={{
                  background: COLORS.bgLayout,
                  borderRadius: 6,
                  padding: '10px 14px',
                  border: '1px solid #f0f0f0',
                }}
              >
                <Flex gap={8} align="center" wrap="wrap">
                  <Text strong style={{ fontSize: 13 }}>{c.user_name}</Text>
                  <Tag style={{ margin: 0, fontSize: 11 }}>{c.role}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{fmt(c.created_at)}</Text>
                </Flex>
                <div style={{ marginTop: 6, fontSize: 13 }}>{c.content}</div>
              </div>
            ))}
          </div>
        )}
        <Divider />
        <CommentComposer shipmentId={shipment.id} />
      </Card>
    </div>
  );
}
