import { useState } from 'react';
import {
  Card,
  Typography,
  Tag,
  Pagination,
  Drawer,
  Divider,
  Image,
  Empty,
  Spin,
  Space,
} from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { TicketStatusTag } from '@/components/feedback/TicketStatusTag';
import { useFeedbackTickets, useFeedbackTicketDetail } from '@/hooks/useFeedback';
import type { IFeedbackTicket } from '@/types';

const { Title, Text, Paragraph } = Typography;

// ─── Public Detail Drawer ─────────────────────────────────────────────────────

interface IPublicDetailDrawerProps {
  ticketId: number | null;
}

function PublicDetailDrawer({ ticketId }: IPublicDetailDrawerProps): React.ReactElement {
  const { t } = useTranslation();
  const { data: ticket, isLoading } = useFeedbackTicketDetail(ticketId);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  if (!ticket) return <Empty />;

  const publicReplies = ticket.replies.filter((r) => r.is_public);

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Tag color="blue">{ticket.category_display}</Tag>
        <TicketStatusTag status={ticket.status} />
      </Space>
      <Title level={5} style={{ marginTop: 0 }}>
        {ticket.title}
      </Title>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {ticket.author_name} — {dayjs(ticket.created_at).format('DD.MM.YYYY')}
      </Text>
      <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
        {ticket.description}
      </Paragraph>

      {ticket.attachments.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Image.PreviewGroup>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ticket.attachments.map((att) => (
                <Image
                  key={att.id}
                  src={att.file}
                  width={80}
                  height={80}
                  style={{ objectFit: 'cover', borderRadius: 4 }}
                  alt={att.original_filename}
                />
              ))}
            </div>
          </Image.PreviewGroup>
        </>
      )}

      {publicReplies.length > 0 && (
        <>
          <Divider style={{ margin: '16px 0 8px' }} />
          <Text strong style={{ fontSize: 13 }}>
            {t('feedback.ticket.replies')}
          </Text>
          <div style={{ marginTop: 8 }}>
            {publicReplies.map((reply) => (
              <div
                key={reply.id}
                style={{
                  background: '#f9f9f9',
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 8,
                  borderLeft: '3px solid #1677ff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 12 }}>
                    {reply.author_name}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {dayjs(reply.created_at).format('DD.MM.YYYY HH:mm')}
                  </Text>
                </div>
                <Paragraph style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  {reply.content}
                </Paragraph>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Public Feed Page ─────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function PublicFeedPage(): React.ReactElement {
  const { t } = useTranslation();
  // page state is sent to the API — server handles pagination
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useFeedbackTickets({ scope: 'public', page });
  const tickets = data?.results ?? [];
  const total = data?.count ?? 0;

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 4 }}>
        {t('feedback.public_feed.title')}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24, fontSize: 13 }}>
        {t('feedback.public_feed.subtitle')}
      </Text>

      {tickets.length === 0 && (
        <Empty description={t('feedback.public_feed.empty')} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tickets.map((ticket: IFeedbackTicket) => (
          <Card
            key={ticket.id}
            hoverable
            onClick={() => setSelectedId(ticket.id)}
            style={{ cursor: 'pointer' }}
            size="small"
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <div style={{ flex: 1 }}>
                <Space wrap style={{ marginBottom: 6 }}>
                  <Tag color="blue">{ticket.category_display}</Tag>
                  <TicketStatusTag status={ticket.status} />
                </Space>
                <Title level={5} style={{ margin: 0, fontSize: 14 }}>
                  {ticket.title}
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {ticket.author_name} — {dayjs(ticket.last_activity_at).format('DD.MM.YYYY')}
                </Text>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <Pagination
            current={page}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={(newPage) => {
              setPage(newPage);
              window.scrollTo(0, 0);
            }}
            showSizeChanger={false}
          />
        </div>
      )}

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={t('feedback.public_feed.drawer_title')}
        width={520}
        destroyOnHidden
      >
        <PublicDetailDrawer ticketId={selectedId} />
      </Drawer>
    </div>
  );
}
