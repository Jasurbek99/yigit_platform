import { Divider, Image, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { IFeedbackReply } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text, Paragraph } = Typography;

interface ITicketReplyThreadProps {
  replies: IFeedbackReply[];
}

export function TicketReplyThread({ replies }: ITicketReplyThreadProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (replies.length === 0) return null;

  return (
    <>
      <Divider style={{ margin: '16px 0 8px' }} />
      <Text strong style={{ fontSize: 13 }}>
        {t('feedback.ticket.replies')} ({replies.length})
      </Text>
      <div style={{ marginTop: 8 }}>
        {replies.map((reply) => (
          <div
            key={reply.id}
            style={{
              background: reply.is_internal ? COLORS.bgYellow : '#f9f9f9',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 8,
              borderLeft: reply.is_internal
                ? '3px solid #faad14'
                : reply.is_public
                ? '3px solid #1677ff'
                : '3px solid #d9d9d9',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Space size={6}>
                <Text strong style={{ fontSize: 12 }}>
                  {reply.author_name}
                </Text>
                {reply.is_internal && (
                  <Tag color="gold" style={{ fontSize: 10, padding: '0 4px' }}>
                    {t('feedback.reply.mode_internal')}
                  </Tag>
                )}
                {reply.is_public && (
                  <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>
                    {t('feedback.reply.mode_public')}
                  </Tag>
                )}
              </Space>
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
  );
}
