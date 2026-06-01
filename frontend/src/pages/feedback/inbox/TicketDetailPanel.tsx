import { Button, Divider, Empty, Image, Select, Space, Spin, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { ReplyComposer } from '@/components/feedback/ReplyComposer';
import { pathToLabel } from '@/components/feedback/pathLabels';
import {
  useFeedbackTicketDetail,
  useUpdateTicketStatus,
} from '@/hooks/useFeedback';
import { TicketReplyThread } from './TicketReplyThread';

const { Text, Title, Paragraph } = Typography;

interface ITicketDetailPanelProps {
  ticketId: number | null;
}

export function TicketDetailPanel({ ticketId }: ITicketDetailPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const { data: ticket, isLoading } = useFeedbackTicketDetail(ticketId);
  const updateStatus = useUpdateTicketStatus(ticketId ?? 0);

  if (!ticketId) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Empty description={t('feedback.inbox.select_ticket')} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin />
      </div>
    );
  }

  if (!ticket) return <Empty />;

  const statusOptions = [
    { value: 'new', label: t('feedback.status.new') },
    { value: 'in_review', label: t('feedback.status.in_review') },
    { value: 'resolved', label: t('feedback.status.resolved') },
    { value: 'rejected', label: t('feedback.status.rejected') },
  ];

  const isActionable =
    (ticket.category === 'bug' || ticket.category === 'suggestion') &&
    ticket.status !== 'resolved' &&
    ticket.status !== 'rejected';

  const handleMarkSolved = () => {
    updateStatus.mutate('resolved', {
      onSuccess: () => toast.success(t('feedback.action.solved_toast')),
    });
  };

  const handleReject = () => {
    updateStatus.mutate('rejected', {
      onSuccess: () => toast.success(t('feedback.action.rejected_toast')),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color="blue">{ticket.category_display}</Tag>
            <Select
              value={ticket.status}
              options={statusOptions}
              size="small"
              style={{ width: 140 }}
              loading={updateStatus.isPending}
              onChange={(val) => updateStatus.mutate(val)}
            />
            {isActionable && (
              <>
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  loading={updateStatus.isPending}
                  onClick={handleMarkSolved}
                >
                  {t('feedback.action.mark_solved')}
                </Button>
                <Button
                  danger
                  size="small"
                  icon={<CloseOutlined />}
                  loading={updateStatus.isPending}
                  onClick={handleReject}
                >
                  {t('feedback.action.mark_rejected')}
                </Button>
              </>
            )}
          </Space>
          <Title level={5} style={{ margin: '8px 0 4px' }}>
            {ticket.title}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {ticket.author_name} ({t(`roles.${ticket.author_role}`)})
            {ticket.submitted_from_path && ` — ${pathToLabel(ticket.submitted_from_path, t)}`}
            {' · '}
            {dayjs(ticket.created_at).format('DD.MM.YYYY HH:mm')}
          </Text>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {ticket.description}
        </Paragraph>

        {ticket.attachments.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Text strong style={{ fontSize: 12 }}>
              {t('feedback.ticket.attachments')}
            </Text>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
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

        <TicketReplyThread replies={ticket.replies} />
      </div>

      <ReplyComposer ticketId={ticket.id} />
    </div>
  );
}
