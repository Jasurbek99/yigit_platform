import { useState } from 'react';
import {
  Button,
  Drawer,
  Typography,
  Divider,
  Image,
  Space,
  Empty,
  Spin,
  Tag,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { TicketStatusTag } from '@/components/feedback/TicketStatusTag';
import { useFeedbackTickets, useFeedbackTicketDetail, useReopenTicket } from '@/hooks/useFeedback';
import type { IFeedbackTicket } from '@/types';

const { Title, Text, Paragraph } = Typography;

// ─── Ticket Detail Drawer ─────────────────────────────────────────────────────

interface IDetailDrawerProps {
  ticketId: number | null;
}

function TicketDetailDrawer({ ticketId }: IDetailDrawerProps): React.ReactElement {
  const { t } = useTranslation();
  const { data: ticket, isLoading } = useFeedbackTicketDetail(ticketId);
  const reopenMutation = useReopenTicket(ticketId ?? 0);

  const canReopen =
    ticket?.status === 'resolved' || ticket?.status === 'rejected';

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  if (!ticket) return <Empty />;

  const publicReplies = ticket.replies.filter((r) => r.mode !== 'internal');

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Tag color="blue">{ticket.category_display}</Tag>
          <TicketStatusTag status={ticket.status} />
          {canReopen && (
            <Button
              size="small"
              onClick={() => reopenMutation.mutate()}
              loading={reopenMutation.isPending}
            >
              {t('feedback.ticket.reopen')}
            </Button>
          )}
        </Space>
        <Title level={5} style={{ margin: '8px 0 4px' }}>
          {ticket.title}
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {dayjs(ticket.created_at).format('DD.MM.YYYY HH:mm')}
        </Text>
      </div>

      {/* Description */}
      <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
        {ticket.description}
      </Paragraph>

      {/* Attachments */}
      {ticket.attachments.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Text strong style={{ fontSize: 12 }}>
            {t('feedback.ticket.attachments')}
          </Text>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: 8,
            }}
          >
            <Image.PreviewGroup>
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
            </Image.PreviewGroup>
          </div>
        </>
      )}

      {/* Reply thread */}
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
                  borderLeft: reply.is_public
                    ? '3px solid #1677ff'
                    : '3px solid #d9d9d9',
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
                {reply.attachments.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <Image.PreviewGroup>
                      {reply.attachments.map((att) => (
                        <Image
                          key={att.id}
                          src={att.file}
                          width={60}
                          height={60}
                          style={{ objectFit: 'cover', borderRadius: 4 }}
                          alt={att.original_filename}
                        />
                      ))}
                    </Image.PreviewGroup>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── My Tickets Page ──────────────────────────────────────────────────────────

export default function MyTicketsPage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useFeedbackTickets({ scope: 'mine' });
  const tickets = data?.results ?? [];

  const columns: ProColumns<IFeedbackTicket>[] = [
    {
      title: t('feedback.table.title'),
      dataIndex: 'title',
      ellipsis: true,
    },
    {
      title: t('feedback.table.category'),
      dataIndex: 'category_display',
      width: 120,
      render: (_, record) => <Tag>{record.category_display}</Tag>,
    },
    {
      title: t('feedback.table.status'),
      dataIndex: 'status',
      width: 120,
      render: (_, record) => <TicketStatusTag status={record.status} />,
    },
    {
      title: t('feedback.table.created_at'),
      dataIndex: 'created_at',
      width: 140,
      render: (val: unknown) => dayjs(val as string).format('DD.MM.YYYY'),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          {t('feedback.my_tickets.title')}
        </Title>
        <Button type="primary" onClick={() => navigate('/feedback/submit')}>
          {t('feedback.my_tickets.submit_new')}
        </Button>
      </div>

      <ProTable<IFeedbackTicket>
        columns={columns}
        dataSource={tickets}
        loading={isLoading}
        rowKey="id"
        search={false}
        options={false}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        onRow={(record) => ({
          onClick: () => setSelectedId(record.id),
          style: { cursor: 'pointer' },
        })}
      />

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={t('feedback.my_tickets.drawer_title')}
        width={520}
        destroyOnHidden
      >
        <TicketDetailDrawer ticketId={selectedId} />
      </Drawer>
    </div>
  );
}
